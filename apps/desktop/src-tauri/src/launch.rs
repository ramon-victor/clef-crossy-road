//! Starting the app: the launch options a shortcut can set, and the scripted self-test.

use std::fs;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, PhysicalSize, State};

use crate::{
    error::{CommandError, CommandResult},
    windows::WindowLayout,
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

pub fn selftest_requested() -> bool {
    std::env::var("CCR_SELFTEST").is_ok()
}

/// Native lifecycle actions used only by the three-window self-test.
#[tauri::command]
pub fn selftest_window_action(
    app: AppHandle,
    layout: State<'_, WindowLayout>,
    action: &str,
) -> CommandResult<()> {
    if !selftest_requested() {
        return Err(CommandError::new("self-test is not enabled"));
    }
    let game = app
        .get_webview_window("main")
        .ok_or_else(|| CommandError::new("game missing"))?;
    match action {
        "close-controls" => {
            app.get_webview_window("controls")
                .ok_or_else(|| CommandError::new("controls missing"))?
                .close()?;
        }
        "close-decisions" => {
            app.get_webview_window("decisions")
                .ok_or_else(|| CommandError::new("decisions missing"))?
                .close()?;
        }
        "minimize-controls" | "minimize-decisions" => {
            let label = if action == "minimize-controls" {
                "controls"
            } else {
                "decisions"
            };
            app.get_webview_window(label)
                .ok_or_else(|| CommandError::new("auxiliary window missing"))?
                .minimize()?;
        }
        "small-decisions" | "restore-decisions-size" => {
            let (height, minimum_height) = if action == "small-decisions" {
                (480.0, 480.0)
            } else {
                (800.0, 640.0)
            };
            let decisions = app
                .get_webview_window("decisions")
                .ok_or_else(|| CommandError::new("decisions missing"))?;
            let ratio = layout.pixel_ratio();
            decisions.set_min_size(Some(PhysicalSize::new(360.0 * ratio, minimum_height * ratio)))?;
            decisions.set_size(PhysicalSize::new(360.0 * ratio, height * ratio))?;
        }
        "minimize" => game.minimize()?,
        "restore" => {
            game.unminimize()?;
            game.set_focus()?;
        }
        _ => return Err(CommandError::new("unknown self-test action")),
    }
    Ok(())
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
