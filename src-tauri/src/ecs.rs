//! Read-only ECS queries with batching.
//! The `fetch_*` functions take `&AppState` so the commands and the poller share them.

use std::fmt::Debug;
use std::future::Future;

use aws_sdk_ecs::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_ecs::types::{
    ClusterField, ClusterSettingName, ContainerDefinition, DesiredStatus, SortOrder, TaskDefinition,
};
use serde_json::{json, Map, Value};
use tauri::State;

use crate::convert::{self, service_summary, task_model};
use crate::error::{aws_err, AppError, AppResult, ErrorKind};
use crate::models::{ClusterSummary, ServiceDetail, ServiceEvent, ServiceHealth, ServiceSummary, Task};
use crate::state::AppState;

const DESCRIBE_CLUSTERS_BATCH: usize = 100;
const DESCRIBE_SERVICES_BATCH: usize = 10;
const DESCRIBE_TASKS_BATCH: usize = 100;
const MAX_EVENTS: usize = 100;

/// Runs one AWS call through the rate limiter. A throttling error slows the bucket.
pub async fn call<T, E, R>(
    st: &AppState,
    profile: &str,
    region: &str,
    fut: impl Future<Output = Result<T, SdkError<E, R>>>,
) -> AppResult<T>
where
    E: ProvideErrorMetadata + std::error::Error + Send + Sync + 'static,
    R: Debug,
{
    st.limiter.acquire(profile, region).await;
    match fut.await {
        Ok(v) => Ok(v),
        Err(e) => {
            let e = aws_err(e);
            if e.kind == ErrorKind::Throttled {
                st.limiter.throttled(profile, region).await;
            }
            Err(e)
        }
    }
}

