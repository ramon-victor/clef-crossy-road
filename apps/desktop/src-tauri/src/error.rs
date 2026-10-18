//! Stable error codes cross IPC; only the UI translates them. Diagnostics stay in English.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

impl CommandError {
    pub fn new(message: impl Into<String>) -> Self {
        Self::coded("bridge", message)
    }

    pub fn coded(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            params: None,
        }
    }

    pub fn with_params(mut self, params: Value) -> Self {
        self.params = Some(params);
        self
    }
}

impl<E: std::error::Error> From<E> for CommandError {
    fn from(error: E) -> Self {
        Self::new(error.to_string())
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reaches_the_webview_with_a_stable_code_and_original_diagnostic() {
        let error = CommandError::coded("quota", "Nothing was sent")
            .with_params(json!({ "spent": 10000, "limit": 10000 }));
        assert_eq!(serde_json::to_value(error).unwrap(), json!({
            "code": "quota", "message": "Nothing was sent",
            "params": { "spent": 10000, "limit": 10000 }
        }));
    }

    #[test]
    fn wraps_standard_errors_without_losing_their_diagnostic() {
        let io = std::fs::read("/definitely/not/here/ccr").unwrap_err();
        let expected = io.to_string();
        let value = serde_json::to_value(CommandError::from(io)).unwrap();
        assert_eq!(value, json!({ "code": "bridge", "message": expected }));
    }
}
