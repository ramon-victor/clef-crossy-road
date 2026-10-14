//! The daily neuron budget: what a call costs, what has been spent, and the refusal when it is spent.
//!
//! The limit is a constant on purpose. The owner's rule is to stay inside the free tier, and the
//! webview must not be able to talk this process into spending more.

use std::{fs, path::Path};

use serde_json::{json, Value};

use crate::files::ledger_path;

/// Cloudflare Workers AI free allocation, per account and UTC day.
pub const DAILY_LIMIT_NEURONS: f64 = 10_000.0;
/// US$ per 1,000 neurons (published rate).
const USD_PER_1000_NEURONS: f64 = 0.011;
/// Only these models may be called through this process, with their US$ per million input tokens.
const MODELS: [(&str, f64); 3] = [("clef", 0.24), ("clef-flash", 0.038), ("clef-omni", 0.15)];

pub fn usd_per_million(model: &str) -> Option<f64> {
    MODELS
        .iter()
        .find(|(name, _)| *name == model)
        .map(|&(_, usd)| usd)
}

pub fn neurons_for(usd_per_million: f64, input_tokens: f64) -> f64 {
    let usd = usd_per_million * input_tokens / 1_000_000.0;
    usd / USD_PER_1000_NEURONS * 1000.0
}

/// Short stable tag for a Cloudflare account: FNV-1a 64-bit of the id, in hex. The free allocation is
/// per account, so the ledger is kept per account without writing ids to disk. The TypeScript side
/// (`accountTag` in packages/clef) computes the same value; both are tested on the same vectors.
pub fn account_tag(account: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in account.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Neurons recorded in the ledger for the given UTC day and account. An entry without an account tag
/// counts toward every account, and so does every entry when no account is known: the guard can only
/// ever get stricter from old or incomplete records, never looser.
pub fn spent_on(root: &Path, day: &str, account: Option<&str>) -> f64 {
    let Ok(text) = fs::read_to_string(ledger_path(root)) else {
        return 0.0;
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|v| v.get("day").and_then(Value::as_str) == Some(day))
        .filter(
            |v| match (v.get("account").and_then(Value::as_str), account) {
                (Some(entry), Some(mine)) => entry == mine,
                _ => true,
            },
        )
        .filter_map(|v| v.get("neurons").and_then(Value::as_f64))
        .sum()
}

/// The text of a refusal. The TypeScript side words it identically (`budgetRefusal`) and the UI
/// recognises it by its opening words.
pub fn refusal_message(spent: f64) -> String {
    format!(
        "Local daily budget reached: {} of {} neurons used today (UTC). Nothing was sent.",
        spent.round() as i64,
        DAILY_LIMIT_NEURONS as i64
    )
}

/// One ledger record for a paid call.
pub fn entry(
    day: &str,
    account_tag: &str,
    model: &str,
    input_tokens: f64,
    usd_per_million: f64,
    at: &str,
) -> Value {
    json!({
        "day": day,
        "account": account_tag,
        "t": at,
        "model": model,
        "inputTokens": input_tokens,
        "neurons": neurons_for(usd_per_million, input_tokens),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::{append_line, TempRoot};

    const DAY: &str = "2026-10-14";

    fn record(root: &TempRoot, line: &str) {
        append_line(&ledger_path(&root.0), line).unwrap();
    }

    #[test]
    fn neuron_rates_match_the_published_pricing() {
        // clef-flash: 3,455 neurons per million tokens; clef: 21,818.
        assert!((neurons_for(0.038, 1_000_000.0) - 3454.5).abs() < 1.0);
        assert!((neurons_for(0.24, 1_000_000.0) - 21818.2).abs() < 1.0);
    }

    #[test]
    fn only_known_models_are_allowed() {
        assert_eq!(usd_per_million("clef-flash"), Some(0.038));
        assert_eq!(usd_per_million("../../other"), None);
        assert_eq!(usd_per_million(""), None);
    }

    #[test]
    fn account_tag_matches_the_fnv1a_64_test_vectors_used_by_the_typescript_side() {
        assert_eq!(account_tag(""), "cbf29ce484222325");
        assert_eq!(account_tag("a"), "af63dc4c8601ec8c");
        assert_eq!(account_tag("foobar"), "85944171f73967e8");
    }

    #[test]
    fn refusal_has_the_exact_words_of_the_typescript_side() {
        assert_eq!(
            refusal_message(26_347.4),
            "Local daily budget reached: 26347 of 10000 neurons used today (UTC). Nothing was sent."
        );
    }

    #[test]
    fn ledger_sums_only_the_requested_day() {
        let root = TempRoot::new("ledger-day");
        record(&root, r#"{"day":"2026-10-13","neurons":9000}"#);
        record(&root, r#"{"day":"2026-10-14","neurons":400.5}"#);
        record(&root, r#"{"day":"2026-10-14","neurons":100}"#);
        assert_eq!(spent_on(&root.0, DAY, None), 500.5);
        assert_eq!(spent_on(&root.0, "2026-10-15", None), 0.0);
    }

    #[test]
    fn the_ledger_is_kept_per_account() {
        let root = TempRoot::new("ledger-account");
        let (old, new) = (account_tag("old-account"), account_tag("new-account"));
        record(
            &root,
            &format!(r#"{{"day":"{DAY}","account":"{old}","neurons":26347}}"#),
        );
        record(
            &root,
            &format!(r#"{{"day":"{DAY}","account":"{new}","neurons":400}}"#),
        );
        assert_eq!(spent_on(&root.0, DAY, Some(&old)), 26347.0);
        assert_eq!(spent_on(&root.0, DAY, Some(&new)), 400.0);
        // With no account known, everything counts: the strictest reading.
        assert_eq!(spent_on(&root.0, DAY, None), 26747.0);
    }

    #[test]
    fn an_untagged_entry_counts_toward_every_account() {
        let root = TempRoot::new("ledger-untagged");
        record(&root, r#"{"day":"2026-10-14","neurons":9999}"#);
        assert_eq!(spent_on(&root.0, DAY, Some(&account_tag("anyone"))), 9999.0);
    }

    #[test]
    fn a_missing_ledger_means_nothing_was_spent() {
        let root = TempRoot::new("ledger-missing");
        assert_eq!(spent_on(&root.0, DAY, None), 0.0);
    }

    #[test]
    fn a_recorded_call_is_read_back_by_the_guard() {
        let root = TempRoot::new("ledger-entry");
        let tag = account_tag("acct");
        let written = entry(
            DAY,
            &tag,
            "clef-flash",
            1_000_000.0,
            0.038,
            "2026-10-14T00:00:00.000Z",
        );
        record(&root, &written.to_string());
        assert!((spent_on(&root.0, DAY, Some(&tag)) - 3454.5).abs() < 1.0);
    }
}
