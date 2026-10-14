//! Where the project keeps its files, and the one way records are appended to them.

use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

/// The workspace root: `CCR_ROOT`, or the nearest ancestor holding `pnpm-workspace.yaml`.
pub fn find_root() -> PathBuf {
    if let Ok(root) = std::env::var("CCR_ROOT") {
        return PathBuf::from(root);
    }
    let starts = [
        std::env::current_dir().ok(),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(Path::to_path_buf)),
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

/// The spend ledger, shared with the benchmark CLI.
pub fn ledger_path(root: &Path) -> PathBuf {
    root.join("runs").join("cache").join("spend.ndjson")
}

/// The decision cache, shared with the benchmark CLI.
pub fn cache_path(root: &Path) -> PathBuf {
    root.join("runs").join("cache").join("clef.ndjson")
}

/// Appends one NDJSON record. A partial last line left by a crash is ended first, so this record is
/// not glued to it, and the record is written in a single call so it cannot interleave with another.
pub fn append_line(path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(path)?;
    let mut record = String::with_capacity(line.len() + 2);
    let len = file.metadata()?.len();
    if len > 0 {
        file.seek(SeekFrom::Start(len - 1))?;
        let mut last = [0u8; 1];
        file.read_exact(&mut last)?;
        if last[0] != b'\n' {
            record.push('\n');
        }
    }
    record.push_str(line);
    record.push('\n');
    file.write_all(record.as_bytes())
}

/// A scratch workspace for tests, removed when it goes out of scope (even if an assertion fails).
#[cfg(test)]
pub struct TempRoot(pub PathBuf);

#[cfg(test)]
impl TempRoot {
    pub fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("ccr-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Self(dir)
    }
}

#[cfg(test)]
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_end_with_a_newline_and_start_on_their_own_line() {
        let root = TempRoot::new("append");
        let path = ledger_path(&root.0);
        append_line(&path, r#"{"a":1}"#).unwrap();
        append_line(&path, r#"{"a":2}"#).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"a\":1}\n{\"a\":2}\n");
    }

    #[test]
    fn a_partial_last_line_does_not_swallow_the_next_record() {
        let root = TempRoot::new("partial");
        let path = ledger_path(&root.0);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{\"day\":\"2026-10-14\",\"neu").unwrap();
        append_line(&path, r#"{"day":"2026-10-14","neurons":250}"#).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert_eq!(
            text.lines().last(),
            Some(r#"{"day":"2026-10-14","neurons":250}"#)
        );
    }

    #[test]
    fn the_ledger_and_the_cache_live_where_the_benchmark_expects_them() {
        let root = Path::new("repo");
        assert!(ledger_path(root).ends_with("runs/cache/spend.ndjson"));
        assert!(cache_path(root).ends_with("runs/cache/clef.ndjson"));
    }
}
