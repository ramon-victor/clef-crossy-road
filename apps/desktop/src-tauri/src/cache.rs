//! The decision cache shared with the benchmark CLI: one `{"k": key, "v": entry}` per line.

use std::{collections::HashMap, fs, path::Path};

use serde_json::Value;

use crate::files::cache_path;

/// Later lines win, and a line cut short by a crash is skipped.
pub fn load(root: &Path) -> HashMap<String, Value> {
    let Ok(text) = fs::read_to_string(cache_path(root)) else {
        return HashMap::new();
    };
    text.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|v| Some((v.get("k")?.as_str()?.to_string(), v.get("v")?.clone())))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::{append_line, TempRoot};

    #[test]
    fn later_lines_win_and_broken_lines_are_skipped() {
        let root = TempRoot::new("cache");
        let path = cache_path(&root.0);
        append_line(&path, r#"{"k":"a","v":{"n":1}}"#).unwrap();
        append_line(&path, "not json").unwrap();
        append_line(&path, r#"{"k":"b","v":{"n":2}}"#).unwrap();
        append_line(&path, r#"{"k":"a","v":{"n":3}}"#).unwrap();
        append_line(&path, r#"{"v":{"n":4}}"#).unwrap();
        let cache = load(&root.0);
        assert_eq!(cache.len(), 2);
        assert_eq!(cache["a"]["n"], 3);
        assert_eq!(cache["b"]["n"], 2);
    }

    #[test]
    fn a_missing_cache_is_empty() {
        let root = TempRoot::new("cache-missing");
        assert!(load(&root.0).is_empty());
    }
}
