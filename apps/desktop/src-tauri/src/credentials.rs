//! Backend-only storage. The UI submits new credentials once and only receives configuration status.

use std::{
    collections::HashMap,
    env,
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::error::{CommandError, CommandResult};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInput {
    account_id: String,
    api_token: String,
}

#[derive(Serialize)]
pub struct CredentialStatus {
    configured: bool,
}

/// Cloned under one lock so an in-flight call keeps its original token AND account's ledger.
#[derive(Clone)]
pub struct Credentials {
    pub account_id: Option<String>,
    pub api_token: Option<String>,
}

pub fn load(root: &Path) -> Credentials {
    load_with(
        root,
        env::var("CF_ACCOUNT_ID").ok(),
        env::var("CF_API_TOKEN").ok(),
    )
}

/// Saved GUI settings take precedence; environment variables remain a startup fallback.
fn load_with(root: &Path, account: Option<String>, token: Option<String>) -> Credentials {
    let saved: HashMap<String, String> = dotenvy::from_path_iter(root.join(".env"))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .collect();
    Credentials {
        account_id: saved
            .get("CF_ACCOUNT_ID")
            .cloned()
            .or(account)
            .map(|v| v.trim().to_ascii_lowercase())
            .filter(|v| !v.is_empty()),
        api_token: saved
            .get("CF_API_TOKEN")
            .cloned()
            .or(token)
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty()),
    }
}

impl Credentials {
    pub fn status(&self) -> CredentialStatus {
        CredentialStatus {
            configured: self.account_id.is_some() && self.api_token.is_some(),
        }
    }

    pub fn save(&mut self, root: &Path, input: CredentialInput) -> CommandResult<CredentialStatus> {
        let next = validated(input)?;
        persist(root, &next)
            .map_err(|_| CommandError::new("Could not save local Cloudflare credentials."))?;
        *self = next;
        Ok(self.status())
    }
}

fn validated(input: CredentialInput) -> CommandResult<Credentials> {
    let account = input.account_id.trim().to_ascii_lowercase();
    let token = input.api_token.trim().to_owned();
    if account.len() != 32 || !account.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(CommandError::new(
            "Account ID must contain 32 hexadecimal characters.",
        ));
    }
    let body = token.trim_end_matches('=');
    if body.is_empty()
        || token.len() > 4096
        || !body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._~+/-".contains(&b))
    {
        return Err(CommandError::new(
            "Enter the API token itself, without Bearer or spaces.",
        ));
    }
    Ok(Credentials {
        account_id: Some(account),
        api_token: Some(token),
    })
}

fn managed(line: &str) -> bool {
    let line = line
        .trim_start()
        .trim_start_matches('\u{feff}')
        .trim_start();
    let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
    matches!(
        line.split_once('=').map(|(key, _)| key.trim()),
        Some("CF_ACCOUNT_ID" | "CF_API_TOKEN")
    )
}

fn persist(root: &Path, credentials: &Credentials) -> io::Result<()> {
    let path = root.join(".env");
    let original = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error),
    };
    let newline = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines: Vec<&str> = original.lines().filter(|line| !managed(line)).collect();
    while lines.last() == Some(&"") {
        lines.pop();
    }
    let mut contents = lines.join(newline);
    if !contents.is_empty() {
        contents.push_str(newline);
    }
    contents.push_str(&format!(
        "CF_ACCOUNT_ID={}{newline}CF_API_TOKEN={}{newline}",
        credentials.account_id.as_deref().unwrap_or_default(),
        credentials.api_token.as_deref().unwrap_or_default()
    ));
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = root.join(format!(".env.ccr-{}-{nonce}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &path)
    })();
    let _ = fs::remove_file(&temporary);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::TempRoot;

    const ACCOUNT: &str = "abcdef0123456789abcdef0123456789";
    const TOKEN: &str = "test_token-for-local-storage_only";

    fn input(account: &str, token: &str) -> CredentialInput {
        CredentialInput {
            account_id: account.into(),
            api_token: token.into(),
        }
    }

    #[test]
    fn saves_reloads_and_never_serializes_credentials_in_status() {
        let root = TempRoot::new("credential-save");
        fs::create_dir_all(&root.0).unwrap();
        let mut store = load_with(&root.0, None, None);
        let status = store
            .save(&root.0, input(&ACCOUNT.to_uppercase(), TOKEN))
            .unwrap();
        assert_eq!(
            serde_json::to_string(&status).unwrap(),
            r#"{"configured":true}"#
        );
        let reloaded = load_with(
            &root.0,
            Some("other-account".into()),
            Some("other-token".into()),
        );
        assert_eq!(reloaded.account_id.as_deref(), Some(ACCOUNT));
        assert_eq!(reloaded.api_token.as_deref(), Some(TOKEN));
    }

    #[test]
    fn preserves_other_settings_comments_and_crlf_and_removes_duplicate_assignments() {
        let root = TempRoot::new("credential-preserve");
        fs::create_dir_all(&root.0).unwrap();
        fs::write(root.0.join(".env"), "# local\r\nOTHER=keep\r\nexport CF_ACCOUNT_ID=old\r\nCF_API_TOKEN=old\r\nCF_API_TOKEN=duplicate\r\n").unwrap();
        let mut store = load_with(&root.0, None, None);
        store.save(&root.0, input(ACCOUNT, TOKEN)).unwrap();
        let text = fs::read_to_string(root.0.join(".env")).unwrap();
        assert!(text.starts_with("# local\r\nOTHER=keep\r\n"));
        assert_eq!(text.matches("CF_API_TOKEN=").count(), 1);
        assert!(!text.contains("duplicate"));
        assert_eq!(fs::read_dir(&root.0).unwrap().count(), 1);
    }

    #[test]
    fn rejects_invalid_input_without_writing_or_echoing_it() {
        let root = TempRoot::new("credential-invalid");
        for (account, token) in [
            ("invalid-account", TOKEN),
            (ACCOUNT, "Bearer test"),
            (ACCOUNT, "test\nOTHER=value"),
            (ACCOUNT, ""),
            (ACCOUNT, "'secret'"),
        ] {
            let mut store = load_with(&root.0, None, None);
            let error = store.save(&root.0, input(account, token)).err().unwrap();
            let message = serde_json::to_string(&error).unwrap();
            assert!(!message.contains(ACCOUNT));
            assert!(!message.contains(TOKEN));
            assert!(!root.0.join(".env").exists());
        }
    }

    #[test]
    fn a_failed_save_preserves_the_active_pair_and_old_snapshots_keep_their_account() {
        let root = TempRoot::new("credential-failed");
        fs::create_dir_all(root.0.join(".env")).unwrap();
        let mut store = load_with(&root.0, Some(ACCOUNT.into()), Some(TOKEN.into()));
        let snapshot = store.clone();
        assert!(store
            .save(
                &root.0,
                input("0123456789abcdef0123456789abcdef", "another_test_token")
            )
            .is_err());
        assert_eq!(store.account_id, snapshot.account_id);
        assert_eq!(store.api_token, snapshot.api_token);
    }
}
