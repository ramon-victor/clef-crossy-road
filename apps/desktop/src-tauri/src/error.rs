//! One error type for every Tauri command. The webview only ever sees its message, as a string.

use serde::{Serialize, Serializer};

#[derive(Debug)]
pub struct CommandError(String);

impl CommandError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

/// Lets `?` turn io, JSON and lock errors into a command error.
impl<E: std::error::Error> From<E> for CommandError {
    fn from(error: E) -> Self {
        Self(error.to_string())
    }
}

impl Serialize for CommandError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reaches_the_webview_as_a_plain_string() {
        let error = CommandError::new("model not allowed: x");
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#""model not allowed: x""#
        );
    }

    #[test]
    fn wraps_standard_errors_with_their_message() {
        let io = std::fs::read("/definitely/not/here/ccr").unwrap_err();
        let expected = io.to_string();
        assert_eq!(CommandError::from(io).0, expected);
    }
}
