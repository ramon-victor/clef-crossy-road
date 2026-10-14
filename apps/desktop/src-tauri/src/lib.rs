//! Native side of Clef Crossy Road.
//!
//! The webview never sees the Cloudflare token. It calls `clef_run`, and this process adds the
//! credentials, enforces the daily neuron budget and records what was spent. The budget limit is a
//! constant on purpose: the owner's rule is to stay inside the free tier, and the webview must not
//! be able to talk this process into spending more.

use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Manager, State};

/// Cloudflare Workers AI free allocation, per account and UTC day.
const DAILY_LIMIT_NEURONS: f64 = 10_000.0;
/// US$ per 1,000 neurons (published rate).
const USD_PER_1000_NEURONS: f64 = 0.011;
/// Only these models may be called through this process.
const MODELS: [(&str, f64); 3] = [("clef", 0.24), ("clef-flash", 0.038), ("clef-omni", 0.15)];

struct AppState {
    root: PathBuf,
    http: reqwest::Client,
    cache: Mutex<HashMap<String, Value>>,
    /// Serialises ledger reads/appends so concurrent calls cannot interleave a record.
    ledger: Mutex<()>,
}

#[derive(Serialize)]
struct RunResponse {
    status: u16,
    json: Value,
    #[serde(rename = "retryAfterMs", skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

#[derive(Serialize)]
struct BudgetStatus {
    spent: f64,
    limit: f64,
    day: String,
}

// ---------------------------------------------------------------------------------------------
// Dates: UTC calendar day without a date crate (Howard Hinnant's civil-from-days).
// ---------------------------------------------------------------------------------------------

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn utc_day_from_unix(secs: u64) -> String {
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    format!("{y:04}-{m:02}-{d:02}")
}

fn utc_day_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    utc_day_from_unix(secs)
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, m, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.000Z",
        rem / 3_600,
        (rem % 3_600) / 60,
        rem % 60
    )
}

// ---------------------------------------------------------------------------------------------
// Project files: .env, ledger, cache
// ---------------------------------------------------------------------------------------------

/// The workspace root: `CCR_ROOT`, or the nearest ancestor holding `pnpm-workspace.yaml`.
fn find_root() -> PathBuf {
    if let Ok(root) = std::env::var("CCR_ROOT") {
        return PathBuf::from(root);
    }
    let starts = [
        std::env::current_dir().ok(),
        std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)),
    ];
    for start in starts.into_iter().flatten() {
        let mut dir = Some(start.as_path());
        while let Some(d) = dir {
            if d.join("pnpm-workspace.yaml").exists() {
                return d.to_path_buf();
            }
            dir = d.parent();
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn ledger_path(root: &Path) -> PathBuf {
    root.join("runs").join("cache").join("spend.ndjson")
}

fn cache_path(root: &Path) -> PathBuf {
    root.join("runs").join("cache").join("clef.ndjson")
}

fn append_line(path: &Path, line: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // End a partial last line left by a crash so this record is not glued to it.
    let needs_newline = fs::read(path).map(|b| !b.is_empty() && b.last() != Some(&b'\n')).unwrap_or(false);
    let mut file = OpenOptions::new().create(true).append(true).open(path).map_err(|e| e.to_string())?;
    if needs_newline {
        file.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    file.write_all(b"\n").map_err(|e| e.to_string())
}

/// Short stable tag for a Cloudflare account: FNV-1a 64-bit of the id, in hex. The free allocation is
/// per account, so the ledger is kept per account without writing ids to disk. The TypeScript side
/// (`accountTag` in packages/clef) computes the same value; both are tested on the same vectors.
fn account_tag(account: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in account.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The account configured in `.env`, if any.
fn current_account(root: &Path) -> Option<String> {
    let _ = dotenvy::from_path(root.join(".env"));
    std::env::var("CF_ACCOUNT_ID").ok().filter(|s| !s.is_empty())
}

/// Neurons recorded in the ledger for the given UTC day and account. An entry without an account tag
/// counts toward every account, and so does every entry when no account is known: the guard can only
/// ever get stricter from old or incomplete records, never looser.
fn spent_on(root: &Path, day: &str, account: Option<&str>) -> f64 {
    let Ok(text) = fs::read_to_string(ledger_path(root)) else {
        return 0.0;
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|v| v.get("day").and_then(Value::as_str) == Some(day))
        .filter(|v| match (v.get("account").and_then(Value::as_str), account) {
            (Some(entry), Some(mine)) => entry == mine,
            _ => true,
        })
        .filter_map(|v| v.get("neurons").and_then(Value::as_f64))
        .sum()
}

fn neurons_for(usd_per_million: f64, input_tokens: f64) -> f64 {
    let usd = usd_per_million * input_tokens / 1_000_000.0;
    usd / USD_PER_1000_NEURONS * 1000.0
}

fn load_cache(root: &Path) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    if let Ok(text) = fs::read_to_string(cache_path(root)) {
        for line in text.lines() {
            if let Ok(v) = serde_json::from_str::<Value>(line) {
                if let (Some(k), Some(entry)) = (v.get("k").and_then(Value::as_str), v.get("v")) {
                    map.insert(k.to_string(), entry.clone());
                }
            }
        }
    }
    map
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

#[tauri::command]
fn budget_status(state: State<'_, AppState>) -> BudgetStatus {
    let day = utc_day_now();
    let tag = current_account(&state.root).map(|a| account_tag(&a));
    BudgetStatus { spent: spent_on(&state.root, &day, tag.as_deref()), limit: DAILY_LIMIT_NEURONS, day }
}

#[tauri::command]
fn cache_get(state: State<'_, AppState>, key: String) -> Option<Value> {
    state.cache.lock().ok()?.get(&key).cloned()
}

#[tauri::command]
fn cache_put(state: State<'_, AppState>, key: String, value: Value) -> Result<(), String> {
    let line = json!({ "k": key, "v": value }).to_string();
    append_line(&cache_path(&state.root), &line)?;
    state.cache.lock().map_err(|e| e.to_string())?.insert(key, value);
    Ok(())
}

/// Sends one request to Workers AI. Refuses locally, without any network traffic, once the day's
/// budget is spent. Never returns or logs the token.
#[tauri::command]
async fn clef_run(state: State<'_, AppState>, model: String, body: Value) -> Result<RunResponse, String> {
    let Some(&(_, usd_per_million)) = MODELS.iter().find(|(m, _)| *m == model) else {
        return Err(format!("model not allowed: {model}"));
    };

    let day = utc_day_now();
    let _ = dotenvy::from_path(state.root.join(".env"));
    let account = std::env::var("CF_ACCOUNT_ID").map_err(|_| "CF_ACCOUNT_ID is not set (see .env.example)".to_string())?;
    let tag = account_tag(&account);
    {
        let _guard = state.ledger.lock().map_err(|e| e.to_string())?;
        let spent = spent_on(&state.root, &day, Some(&tag));
        if spent >= DAILY_LIMIT_NEURONS {
            return Err(format!(
                "Local daily budget reached: {} of {} neurons used today (UTC). Nothing was sent.",
                spent.round() as i64,
                DAILY_LIMIT_NEURONS as i64
            ));
        }
    }

    let token = std::env::var("CF_API_TOKEN").map_err(|_| "CF_API_TOKEN is not set (see .env.example)".to_string())?;
    let url = format!("https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/{model}");

    let response = state
        .http
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e.without_url()))?;

    let status = response.status().as_u16();
    let retry_after_ms = response
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<f64>().ok())
        .map(|secs| (secs * 1000.0) as u64);
    let json: Value = response.json().await.unwrap_or(Value::Null);

    if (200..300).contains(&status) {
        let tokens = json
            .pointer("/result/usage/input_tokens")
            .or_else(|| json.pointer("/usage/input_tokens"))
            .and_then(Value::as_f64);
        if let Some(tokens) = tokens {
            let entry = json!({
                "day": day,
                "account": tag,
                "t": iso_now(),
                "model": model,
                "inputTokens": tokens,
                "neurons": neurons_for(usd_per_million, tokens),
            });
            let _guard = state.ledger.lock().map_err(|e| e.to_string())?;
            append_line(&ledger_path(&state.root), &entry.to_string())?;
        }
    }

    Ok(RunResponse { status, json, retry_after_ms })
}

/// True when the app was launched with `CCR_SELFTEST=1` (used by scripted checks, never by players).
#[tauri::command]
fn selftest_enabled() -> bool {
    std::env::var("CCR_SELFTEST").is_ok()
}

/// Used by the self-test (`CCR_SELFTEST=1`): the webview reports what it measured, then the app exits.
#[tauri::command]
fn report_selftest(app: tauri::AppHandle, state: State<'_, AppState>, report: Value) -> Result<(), String> {
    if std::env::var("CCR_SELFTEST").is_err() {
        return Err("self-test is not enabled".into());
    }
    let path = state.root.join("runs").join("selftest.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = find_root();
    let state = AppState {
        cache: Mutex::new(load_cache(&root)),
        root,
        http: reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("failed to build the HTTP client"),
        ledger: Mutex::new(()),
    };

    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            clef_run,
            cache_get,
            cache_put,
            budget_status,
            selftest_enabled,
            report_selftest
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Clef Crossy Road");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_unix_time_to_utc_dates() {
        assert_eq!(utc_day_from_unix(0), "1970-01-01");
        assert_eq!(utc_day_from_unix(951_782_400), "2000-02-29"); // leap day
        assert_eq!(utc_day_from_unix(1_791_936_000), "2026-10-14"); // 00:00:00 UTC
        assert_eq!(utc_day_from_unix(1_791_936_000 + 86_399), "2026-10-14"); // 23:59:59 UTC
        assert_eq!(utc_day_from_unix(1_791_936_000 - 1), "2026-10-13");
    }

    #[test]
    fn neuron_rates_match_the_published_pricing() {
        // clef-flash: 3,455 neurons per million tokens; clef: 21,818.
        assert!((neurons_for(0.038, 1_000_000.0) - 3454.5).abs() < 1.0);
        assert!((neurons_for(0.24, 1_000_000.0) - 21818.2).abs() < 1.0);
    }

    #[test]
    fn only_known_models_are_allowed() {
        assert!(MODELS.iter().any(|(m, _)| *m == "clef-flash"));
        assert!(!MODELS.iter().any(|(m, _)| *m == "../../other"));
    }

    #[test]
    fn ledger_sums_only_the_requested_day() {
        let dir = std::env::temp_dir().join(format!("ccr-ledger-test-{}", std::process::id()));
        let path = ledger_path(&dir);
        append_line(&path, r#"{"day":"2026-10-13","neurons":9000}"#).unwrap();
        append_line(&path, r#"{"day":"2026-10-14","neurons":400.5}"#).unwrap();
        append_line(&path, r#"{"day":"2026-10-14","neurons":100}"#).unwrap();
        assert_eq!(spent_on(&dir, "2026-10-14", None), 500.5);
        assert_eq!(spent_on(&dir, "2026-10-15", None), 0.0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn account_tag_matches_the_fnv1a_64_test_vectors_used_by_the_typescript_side() {
        assert_eq!(account_tag(""), "cbf29ce484222325");
        assert_eq!(account_tag("a"), "af63dc4c8601ec8c");
        assert_eq!(account_tag("foobar"), "85944171f73967e8");
    }

    #[test]
    fn the_ledger_is_kept_per_account() {
        let dir = std::env::temp_dir().join(format!("ccr-account-test-{}", std::process::id()));
        let path = ledger_path(&dir);
        let old = account_tag("old-account");
        let new = account_tag("new-account");
        append_line(&path, &format!(r#"{{"day":"2026-10-14","account":"{old}","neurons":26347}}"#)).unwrap();
        append_line(&path, &format!(r#"{{"day":"2026-10-14","account":"{new}","neurons":400}}"#)).unwrap();
        assert_eq!(spent_on(&dir, "2026-10-14", Some(&old)), 26347.0);
        assert_eq!(spent_on(&dir, "2026-10-14", Some(&new)), 400.0);
        // With no account known, everything counts: the strictest reading.
        assert_eq!(spent_on(&dir, "2026-10-14", None), 26747.0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_untagged_entry_counts_toward_every_account() {
        let dir = std::env::temp_dir().join(format!("ccr-untagged-test-{}", std::process::id()));
        let path = ledger_path(&dir);
        append_line(&path, r#"{"day":"2026-10-14","neurons":9999}"#).unwrap();
        assert_eq!(spent_on(&dir, "2026-10-14", Some(&account_tag("anyone"))), 9999.0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_partial_last_line_does_not_swallow_the_next_record() {
        let dir = std::env::temp_dir().join(format!("ccr-partial-test-{}", std::process::id()));
        let path = ledger_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\"day\":\"2026-10-14\",\"neu").unwrap();
        append_line(&path, r#"{"day":"2026-10-14","neurons":250}"#).unwrap();
        assert_eq!(spent_on(&dir, "2026-10-14", None), 250.0);
        let _ = fs::remove_dir_all(&dir);
    }
}
