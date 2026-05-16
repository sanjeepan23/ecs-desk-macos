//! Small helpers for actions, logs, metrics, and exec.

use std::fmt::Debug;

use aws_sdk_ecs::error::{ProvideErrorMetadata, SdkError};

use crate::error::{aws_err, AppError, ErrorKind};
use crate::state::AppState;

/// Maps an SDK error and slows the rate limiter when AWS throttles us.
pub async fn fail<E, R>(state: &AppState, profile: &str, region: &str, e: SdkError<E, R>) -> AppError
where
    E: ProvideErrorMetadata + std::error::Error + Send + Sync + 'static,
    R: Debug,
{
    let err = aws_err(e);
    if err.kind == ErrorKind::Throttled {
        state.limiter.throttled(profile, region).await;
    }
    err
}

/// Returns the last path segment of an ARN, or the input when it is not an ARN.
pub fn short_name(name_or_arn: &str) -> &str {
    if name_or_arn.starts_with("arn:") {
        name_or_arn.rsplit('/').next().unwrap_or(name_or_arn)
    } else {
        name_or_arn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_name_handles_arns_and_names() {
        assert_eq!(short_name("arn:aws:ecs:us-east-1:123:cluster/web"), "web");
        assert_eq!(short_name("arn:aws:ecs:us-east-1:123:task/web/abc123"), "abc123");
        assert_eq!(short_name("web"), "web");
    }
}
