//! Native side of Clef Crossy Road.
//!
//! Saved credentials stay here. The UI submits replacements once; `clef_run` adds the
//! credentials, enforces the daily neuron budget and records what was spent (see `ledger`).

mod cache;
mod clock;
mod commands;
mod credentials;
mod error;
mod files;
mod launch;
mod ledger;
mod logging;

use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};

use serde_json::Value;
use tauri::Manager;

const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

pub struct AppState {
    root: PathBuf,
    http: reqwest::Client,
    cache: Mutex<HashMap<String, Value>>,
    /// Serialises ledger reads and appends so concurrent calls cannot interleave a record.
    ledger: Mutex<()>,
    credentials: Mutex<credentials::Credentials>,
    /// What `CCR_LOG` asked to be printed in the terminal (nothing, unless it was set).
    log: logging::ConsoleLog,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let root = files::find_root();
    let credentials = Mutex::new(credentials::load(&root));
    let state = AppState {
        cache: Mutex::new(cache::load(&root)),
        log: logging::ConsoleLog::open(&root, logging::LogMode::from_env()),
        root,
        http: reqwest::Client::builder()
            .timeout(HTTP_TIMEOUT)
            .build()
            .expect("failed to build the HTTP client"),
        ledger: Mutex::new(()),
        credentials,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::clef_run,
            commands::cache_get,
            commands::cache_put,
            commands::budget_status,
            commands::credential_status,
            commands::save_credentials,
            logging::console_log,
            launch::launch_options,
            launch::selftest_enabled,
            launch::report_selftest
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
