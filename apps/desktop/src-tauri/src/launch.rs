//! Starting the app: the launch options a shortcut can set, and the scripted self-test.

use std::fs;

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::{
    error::{CommandError, CommandResult},
    AppState,
};

/// Parses a seed given on the command line or in the environment: an unsigned 32-bit integer.
fn parse_seed(text: &str) -> Option<u32> {
    text.trim().parse::<u32>().ok()
}

/// Optional launch settings (`CCR_PLAYER`, `CCR_SEED`, `CCR_LOG`) so a shortcut can open the app on a given
/// player and map, for example Clef-flash replaying seed 1 from the cache, and say how much to log.
#[tauri::command]
pub fn launch_options(state: State<'_, AppState>) -> Value {
    let player = std::env::var("CCR_PLAYER")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let seed = std::env::var("CCR_SEED").ok().and_then(|s| parse_seed(&s));
    json!({ "player": player, "seed": seed, "log": state.log.mode().as_str() })
}

fn selftest_requested() -> bool {
    std::env::var("CCR_SELFTEST").is_ok()
}

/// True when the app was launched with `CCR_SELFTEST=1` (used by scripted checks, never by players).
#[tauri::command]
pub fn selftest_enabled() -> bool {
    selftest_requested()
}

/// Used by the self-test: the webview reports what it measured, then the app exits.
#[tauri::command]
pub fn report_selftest(
    app: AppHandle,
    state: State<'_, AppState>,
    report: Value,
) -> CommandResult<()> {
    if !selftest_requested() {
        return Err(CommandError::new("self-test is not enabled"));
    }
    let path = state.root.join("runs").join("selftest.json");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, serde_json::to_string_pretty(&report)?)?;
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seeds_are_unsigned_32_bit_integers() {
        assert_eq!(parse_seed("1"), Some(1));
        assert_eq!(parse_seed(" 4294967295 "), Some(u32::MAX));
        for bad in ["4294967296", "-3", "abc", ""] {
            assert_eq!(parse_seed(bad), None, "{bad:?}");
        }
    }
}
