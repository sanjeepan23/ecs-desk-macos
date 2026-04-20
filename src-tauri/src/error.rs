use std::fmt::Debug;

use aws_sdk_ecs::error::{DisplayErrorContext, ProvideErrorMetadata, SdkError};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
    Auth,
    Throttled,
    NotFound,
    ReadOnly,
    Invalid,
    Aws,
    Internal,
}

/// Error type for every Tauri command. The UI reads `kind` to pick a message.
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }

    pub fn read_only(profile: &str) -> Self {
        Self::new(
            ErrorKind::ReadOnly,
            format!("{profile} is read-only. Turn off read-only mode for this profile to run actions."),
        )
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Invalid, message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        Self::internal(format!("{e:#}"))
    }
}

/// Maps any AWS SDK error to an `AppError` with a useful kind.
pub fn aws_err<E, R>(e: SdkError<E, R>) -> AppError
where
    E: ProvideErrorMetadata + std::error::Error + Send + Sync + 'static,
    R: Debug,
{
    let code = e.code().map(str::to_owned);
    let text = format!("{}", DisplayErrorContext(&e));
    let kind = classify(code.as_deref(), &text);
    let message = match (&code, e.message()) {
        (Some(c), Some(m)) => format!("{c}: {m}"),
        (_, Some(m)) => m.to_owned(),
        _ => text,
    };
    AppError::new(kind, message)
}

pub fn classify(code: Option<&str>, text: &str) -> ErrorKind {
    match code {
        Some("ThrottlingException" | "Throttling" | "TooManyRequestsException" | "RequestLimitExceeded") => {
            return ErrorKind::Throttled
        }
        Some(
            "ExpiredToken" | "ExpiredTokenException" | "UnrecognizedClientException" | "InvalidClientTokenId"
            | "AccessDeniedException" | "AccessDenied",
        ) => return ErrorKind::Auth,
        Some("ClusterNotFoundException" | "ServiceNotFoundException" | "ResourceNotFoundException") => {
            return ErrorKind::NotFound
        }
        Some("InvalidParameterException" | "InvalidParameterValueException") => return ErrorKind::Invalid,
        _ => {}
    }
    let t = text.to_ascii_lowercase();
    if t.contains("credential") || t.contains("sso") || t.contains("token") && t.contains("expired") {
        ErrorKind::Auth
    } else {
        ErrorKind::Aws
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_codes() {
        assert_eq!(classify(Some("ThrottlingException"), ""), ErrorKind::Throttled);
        assert_eq!(classify(Some("ExpiredTokenException"), ""), ErrorKind::Auth);
        assert_eq!(classify(Some("ServiceNotFoundException"), ""), ErrorKind::NotFound);
        assert_eq!(classify(None, "failed to load credentials from the SSO cache"), ErrorKind::Auth);
        assert_eq!(classify(Some("ServerException"), "boom"), ErrorKind::Aws);
    }
}
