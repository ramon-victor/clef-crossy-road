//! The commands the webview can call. It never sees the Cloudflare token: `clef_run` adds the
//! credentials here, refuses once the day's budget is spent, and records what a call cost.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::State;

use crate::{
    clock, credentials,
    error::{CommandError, CommandResult},
    files, ledger, AppState,
};

#[derive(Serialize)]
pub struct RunResponse {
    status: u16,
    json: Value,
    #[serde(rename = "retryAfterMs", skip_serializing_if = "Option::is_none")]
    retry_after_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct BudgetStatus {
    spent: f64,
    limit: f64,
    day: String,
}

#[tauri::command]
pub fn budget_status(state: State<'_, AppState>) -> BudgetStatus {
    let day = clock::utc_day_now();
    let tag = credentials::account_id().map(|account| ledger::account_tag(&account));
    BudgetStatus {
        spent: ledger::spent_on(&state.root, &day, tag.as_deref()),
        limit: ledger::DAILY_LIMIT_NEURONS,
        day,
    }
}

#[tauri::command]
pub fn cache_get(state: State<'_, AppState>, key: String) -> Option<Value> {
    state.cache.lock().ok()?.get(&key).cloned()
}

#[tauri::command]
pub fn cache_put(state: State<'_, AppState>, key: String, value: Value) -> CommandResult<()> {
    let line = json!({ "k": key, "v": value }).to_string();
    files::append_line(&files::cache_path(&state.root), &line)?;
    state.cache.lock()?.insert(key, value);
    Ok(())
}

/// The input tokens a Workers AI response reports, wrapped in `result` (REST) or not (binding).
fn input_tokens(response: &Value) -> Option<f64> {
    response
        .pointer("/result/usage/input_tokens")
        .or_else(|| response.pointer("/usage/input_tokens"))
        .and_then(Value::as_f64)
}

/// Sends one request to Workers AI. Refuses locally, without any network traffic, once the day's
/// budget is spent. Never returns or logs the token.
#[tauri::command]
pub async fn clef_run(
    state: State<'_, AppState>,
    model: String,
    body: Value,
) -> CommandResult<RunResponse> {
    let usd_per_million = ledger::usd_per_million(&model)
        .ok_or_else(|| CommandError::new(format!("model not allowed: {model}")))?;
    let account = credentials::account_id()
        .ok_or_else(|| CommandError::new("CF_ACCOUNT_ID is not set (see .env.example)"))?;
    let tag = ledger::account_tag(&account);
    let day = clock::utc_day_now();

    {
        let _guard = state.ledger.lock()?;
        let spent = ledger::spent_on(&state.root, &day, Some(&tag));
        if spent >= ledger::DAILY_LIMIT_NEURONS {
            return Err(CommandError::new(ledger::refusal_message(spent)));
        }
    }

    let token = credentials::api_token()
        .ok_or_else(|| CommandError::new("CF_API_TOKEN is not set (see .env.example)"))?;
    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/{model}"
    );
    let response = state
        .http
        .post(url)
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .map_err(|e| CommandError::new(format!("network error: {}", e.without_url())))?;

    let status = response.status().as_u16();
    let retry_after_ms = response
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<f64>().ok())
        .map(|secs| (secs * 1000.0) as u64);
    let json: Value = response.json().await.unwrap_or(Value::Null);

    if (200..300).contains(&status) {
        if let Some(tokens) = input_tokens(&json) {
            let entry = ledger::entry(
                &day,
                &tag,
                &model,
                tokens,
                usd_per_million,
                &clock::iso_now(),
            );
            let _guard = state.ledger.lock()?;
            files::append_line(&files::ledger_path(&state.root), &entry.to_string())?;
        }
    }

    Ok(RunResponse {
        status,
        json,
        retry_after_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_token_count_from_the_rest_envelope_and_from_the_binding_shape() {
        let rest = json!({ "result": { "usage": { "input_tokens": 1120 } }, "success": true });
        let binding = json!({ "usage": { "input_tokens": 3070 } });
        assert_eq!(input_tokens(&rest), Some(1120.0));
        assert_eq!(input_tokens(&binding), Some(3070.0));
        assert_eq!(input_tokens(&json!({ "errors": [] })), None);
    }
}
