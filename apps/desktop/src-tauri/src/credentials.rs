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

fn assignment(line: &str) -> Option<(&str, &str)> {
    let line = line
        .trim_start()
        .trim_start_matches('\u{feff}')
        .trim_start();
    let line = line
        .strip_prefix("export")
        .filter(|tail| tail.starts_with(char::is_whitespace))
        .unwrap_or(line)
        .trim_start();
    let (key, value) = line.split_once('=')?;
    let key = key.trim();
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
        return None;
    }
    Some((key, value.trim_start()))
}

/// Replace complete assignments in place, preserving unrelated multiline values and interpolation order.
fn update_env(original: &str, credentials: &Credentials) -> io::Result<String> {
    let newline = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let replacements = [
        (
            "CF_ACCOUNT_ID",
            credentials.account_id.as_deref().unwrap_or_default(),
        ),
        (
            "CF_API_TOKEN",
            credentials.api_token.as_deref().unwrap_or_default(),
        ),
    ];
    let mut written = [false; 2];
    let mut output = Vec::new();
    let mut lines = original.lines();
    while let Some(line) = lines.next() {
        let (key, _) = assignment(line).unwrap_or(("", ""));
        let mut block = vec![line];
        if !key.is_empty() {
            // Use the same parser as loading, including escaped quotes and concatenated values.
            let mut record = line.to_owned();
            while dotenvy::from_read_iter(record.as_bytes()).any(|entry| entry.is_err()) {
                let tail = lines.next().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidData, "Unclosed dotenv value")
                })?;
                record.push('\n');
                record.push_str(tail);
                block.push(tail);
            }
        }
        if let Some(index) = replacements.iter().position(|(name, _)| *name == key) {
            if !written[index] {
                output.push(format!("{key}={}", replacements[index].1));
                written[index] = true;
            }
        } else {
            output.extend(block.into_iter().map(str::to_owned));
        }
    }
    while output.last().is_some_and(String::is_empty) {
        output.pop();
    }
    for (index, (key, value)) in replacements.into_iter().enumerate() {
        if !written[index] {
            output.push(format!("{key}={value}"));
        }
    }
    Ok(output.join(newline) + newline)
}

fn persist(root: &Path, credentials: &Credentials) -> io::Result<()> {
    let path = root.join(".env");
    let original = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error),
    };
    let contents = update_env(&original, credentials)?;
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
    fn preserves_multiline_settings_and_replaces_credentials_before_interpolation() {
        let root = TempRoot::new("credential-multiline");
        fs::create_dir_all(&root.0).unwrap();
        let notes = "NOTES=\"keep\nCF_API_TOKEN=example\nlast line\"\nFOLDER='C:\\path\\\\'\n";
        fs::write(root.0.join(".env"), format!("{notes}CF_ACCOUNT_ID=old\nCOPY=${{CF_ACCOUNT_ID}}\nCF_API_TOKEN=\"old\ncontinued\"\nOTHER=keep\n")).unwrap();
        load_with(&root.0, None, None)
            .save(&root.0, input(ACCOUNT, TOKEN))
            .unwrap();
        assert_eq!(fs::read_to_string(root.0.join(".env")).unwrap(), format!("{notes}CF_ACCOUNT_ID={ACCOUNT}\nCOPY=${{CF_ACCOUNT_ID}}\nCF_API_TOKEN={TOKEN}\nOTHER=keep\n"));
        let saved: HashMap<String, String> = dotenvy::from_path_iter(root.0.join(".env"))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(saved.get("COPY").unwrap(), ACCOUNT);
        assert_eq!(saved.get("CF_API_TOKEN").unwrap(), TOKEN);
    }

    #[test]
    fn refuses_unterminated_multiline_files_without_changing_them() {
        let root = TempRoot::new("credential-unclosed");
        fs::create_dir_all(&root.0).unwrap();
        let original = "NOTES=\"unfinished\nOTHER=keep\n";
        fs::write(root.0.join(".env"), original).unwrap();
        assert!(load_with(&root.0, None, None)
            .save(&root.0, input(ACCOUNT, TOKEN))
            .is_err());
        assert_eq!(fs::read_to_string(root.0.join(".env")).unwrap(), original);
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
