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

pub async fn fetch_clusters(st: &AppState, profile: &str, region: &str) -> AppResult<Vec<ClusterSummary>> {
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let mut arns = Vec::new();
    let mut token = None;
    loop {
        let out = call(st, profile, region, ecs.list_clusters().set_next_token(token).max_results(100).send()).await?;
        arns.extend(out.cluster_arns().iter().cloned());
        token = out.next_token().map(str::to_owned);
        if token.is_none() {
            break;
        }
    }
    let mut clusters = Vec::new();
    for chunk in arns.chunks(DESCRIBE_CLUSTERS_BATCH) {
        let out = call(
            st,
            profile,
            region,
            ecs.describe_clusters()
                .set_clusters(Some(chunk.to_vec()))
                .include(ClusterField::Settings)
                .include(ClusterField::Statistics)
                .send(),
        )
        .await?;
        for c in out.clusters() {
            let insights = c
                .settings()
                .iter()
                .find(|s| matches!(s.name(), Some(ClusterSettingName::ContainerInsights)))
                .and_then(|s| s.value())
                .is_some_and(|v| v == "enabled" || v == "enhanced");
            clusters.push(ClusterSummary {
                arn: c.cluster_arn().unwrap_or_default().to_owned(),
                name: c.cluster_name().unwrap_or_default().to_owned(),
                status: c.status().unwrap_or_default().to_owned(),
                active_services: c.active_services_count(),
                running_tasks: c.running_tasks_count(),
                pending_tasks: c.pending_tasks_count(),
                capacity_providers: c.capacity_providers().to_vec(),
                container_insights: insights,
            });
        }
    }
    clusters.sort_by(|a, b| a.name.cmp(&b.name));
    st.note_resource_names(profile, clusters.iter().map(|c| c.name.as_str())).await;
    Ok(clusters)
}

