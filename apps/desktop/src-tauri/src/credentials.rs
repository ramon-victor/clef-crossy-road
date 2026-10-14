//! Cloudflare credentials. They live only in the process environment, loaded once from `.env` at
//! startup, and are never sent to the webview or logged.

use std::{env, path::Path};

/// Loads `.env` from the workspace root. Variables that are already set in the environment win.
pub fn load(root: &Path) {
    let _ = dotenvy::from_path(root.join(".env"));
}

fn var(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.is_empty())
}

pub fn account_id() -> Option<String> {
    var("CF_ACCOUNT_ID")
}

pub fn api_token() -> Option<String> {
    var("CF_API_TOKEN")
}
