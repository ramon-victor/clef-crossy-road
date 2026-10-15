//! The log a person watches in the terminal that opened the app (`play.cmd`): what the model was asked
//! and what it answered, one decision at a time.
//!
//! The webview builds the text (it is the one that knows the request, even when the answer came from
//! the cache) and hands it to `console_log`, which only prints. Nothing secret can reach it: the token
//! lives on this side and never goes to the webview.

use std::{
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::State;

use crate::AppState;

/// `CCR_LOG`: how much to print. Off unless asked for, so an app opened any other way stays quiet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogMode {
    Off,
    /// One line per decision.
    Brief,
    /// The state and the answer of every decision, and the question once per game.
    Full,
}

impl LogMode {
    pub fn parse(text: &str) -> Self {
        match text.trim().to_ascii_lowercase().as_str() {
            "brief" => Self::Brief,
            "full" | "1" | "true" | "on" | "yes" => Self::Full,
            _ => Self::Off,
        }
    }

    pub fn from_env() -> Self {
        std::env::var("CCR_LOG").map_or(Self::Off, |text| Self::parse(&text))
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Brief => "brief",
            Self::Full => "full",
        }
    }
}

/// The longest text one call may print. A full request is a few KB; this only stops a runaway caller.
const MAX_TEXT_BYTES: usize = 64 * 1024;

/// The text cut to `MAX_TEXT_BYTES` on a character boundary, with a mark when it was cut.
fn limited(text: &str) -> String {
    if text.len() <= MAX_TEXT_BYTES {
        return text.to_owned();
    }
    let mut end = MAX_TEXT_BYTES;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... [cut]", &text[..end])
}

/// Writes `text` and a newline, then flushes. A closed terminal or a full disk must never take the
/// app down, so write errors are dropped.
pub fn write_line(out: &mut impl Write, text: &str) {
    let _ = writeln!(out, "{}", limited(text));
    let _ = out.flush();
}

pub fn log_file_path(root: &Path) -> PathBuf {
    root.join("runs").join("logs").join("play.log")
}

pub struct ConsoleLog {
    mode: LogMode,
    /// The same lines, kept in `runs/logs/play.log` (recreated at every launch) to read later or paste.
    file: Mutex<Option<File>>,
}

impl ConsoleLog {
    pub fn open(root: &Path, mode: LogMode) -> Self {
        let file = (mode != LogMode::Off)
            .then(|| {
                let path = log_file_path(root);
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).ok()?;
                }
                File::create(path).ok()
            })
            .flatten();
        Self {
            mode,
            file: Mutex::new(file),
        }
    }

    pub fn mode(&self) -> LogMode {
        self.mode
    }

    /// Prints one line to standard output (which `play.cmd` pipes to the terminal) and to the file.
    pub fn line(&self, text: &str) {
        if self.mode == LogMode::Off {
            return;
        }
        write_line(&mut io::stdout(), text);
        if let Ok(mut guard) = self.file.lock() {
            if let Some(file) = guard.as_mut() {
                write_line(file, text);
            }
        }
    }
}

/// Lets the webview print a line in the terminal. Does nothing unless `CCR_LOG` turned the log on.
#[tauri::command]
pub fn console_log(state: State<'_, AppState>, text: String) {
    state.log.line(&text);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::TempRoot;

    #[test]
    fn the_mode_comes_from_a_word_and_defaults_to_off() {
        assert_eq!(LogMode::parse("full"), LogMode::Full);
        for word in ["1", "true", "ON", " Yes "] {
            assert_eq!(LogMode::parse(word), LogMode::Full, "{word:?}");
        }
        assert_eq!(LogMode::parse("brief"), LogMode::Brief);
        for word in ["", "off", "0", "verbose", "no"] {
            assert_eq!(LogMode::parse(word), LogMode::Off, "{word:?}");
        }
        assert_eq!(LogMode::Full.as_str(), "full");
    }

    #[test]
    fn a_line_ends_with_a_newline_and_is_flushed() {
        let mut out = Vec::new();
        write_line(&mut out, "hello");
        write_line(&mut out, "");
        assert_eq!(String::from_utf8(out).unwrap(), "hello\n\n");
    }

    #[test]
    fn a_long_text_is_cut_on_a_character_boundary() {
        let text = "é".repeat(MAX_TEXT_BYTES); // two bytes each, so the cut falls mid-character
        let cut = limited(&text);
        assert!(cut.ends_with("... [cut]"));
        assert!(cut.len() <= MAX_TEXT_BYTES + "... [cut]".len());
        assert!(cut.is_char_boundary(cut.len() - "... [cut]".len()));
        assert_eq!(limited("short"), "short");
    }

    #[test]
    fn a_failing_output_does_not_panic() {
        struct Broken;
        impl Write for Broken {
            fn write(&mut self, _: &[u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
            }
            fn flush(&mut self) -> io::Result<()> {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
            }
        }
        write_line(&mut Broken, "anything");
    }

    #[test]
    fn the_file_keeps_the_lines_and_is_recreated_at_each_launch() {
        let root = TempRoot::new("log");
        let log = ConsoleLog::open(&root.0, LogMode::Full);
        log.line("first");
        log.line("second");
        let path = log_file_path(&root.0);
        assert_eq!(fs::read_to_string(&path).unwrap(), "first\nsecond\n");

        let again = ConsoleLog::open(&root.0, LogMode::Brief);
        again.line("new launch");
        assert_eq!(fs::read_to_string(&path).unwrap(), "new launch\n");
    }

    #[test]
    fn with_the_log_off_nothing_is_written_and_no_file_is_made() {
        let root = TempRoot::new("log-off");
        let log = ConsoleLog::open(&root.0, LogMode::Off);
        log.line("never");
        assert!(!log_file_path(&root.0).exists());
        assert_eq!(log.mode(), LogMode::Off);
    }
}
