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

pub async fn fetch_services(
    st: &AppState,
    profile: &str,
    region: &str,
    cluster: &str,
) -> AppResult<Vec<ServiceSummary>> {
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let mut arns = Vec::new();
    let mut token = None;
    loop {
        let out = call(
            st,
            profile,
            region,
            ecs.list_services().cluster(cluster).set_next_token(token).max_results(100).send(),
        )
        .await?;
        arns.extend(out.service_arns().iter().cloned());
        token = out.next_token().map(str::to_owned);
        if token.is_none() {
            break;
        }
    }
    let mut services = Vec::new();
    for chunk in arns.chunks(DESCRIBE_SERVICES_BATCH) {
        let out = call(
            st,
            profile,
            region,
            ecs.describe_services().cluster(cluster).set_services(Some(chunk.to_vec())).send(),
        )
        .await?;
        services.extend(out.services().iter().map(service_summary));
    }
    services.sort_by(|a, b| a.name.cmp(&b.name));
    st.note_resource_names(profile, services.iter().map(|s| s.name.as_str())).await;
    Ok(services)
}

pub async fn fetch_service(
    st: &AppState,
    profile: &str,
    region: &str,
    cluster: &str,
    service: &str,
) -> AppResult<ServiceDetail> {
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let out = call(st, profile, region, ecs.describe_services().cluster(cluster).services(service).send()).await?;
    let s = out
        .services()
        .first()
        .ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("Service {service} not found in {cluster}.")))?;
    let mut events: Vec<ServiceEvent> = s.events().iter().map(convert::service_event).collect();
    events.sort_by_key(|e| std::cmp::Reverse(e.created_at));
    events.truncate(MAX_EVENTS);
    Ok(ServiceDetail { service: service_summary(s), events })
}

pub async fn fetch_tasks(
    st: &AppState,
    profile: &str,
    region: &str,
    cluster: &str,
    service: Option<&str>,
    desired_status: &str,
) -> AppResult<Vec<Task>> {
    let status = match desired_status {
        "RUNNING" => DesiredStatus::Running,
        "STOPPED" => DesiredStatus::Stopped,
        other => return Err(AppError::invalid(format!("desiredStatus must be RUNNING or STOPPED, not {other}."))),
    };
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let mut arns = Vec::new();
    let mut token = None;
    loop {
        let out = call(
            st,
            profile,
            region,
            ecs.list_tasks()
                .cluster(cluster)
                .set_service_name(service.map(str::to_owned))
                .desired_status(status.clone())
                .set_next_token(token)
                .max_results(100)
                .send(),
        )
        .await?;
        arns.extend(out.task_arns().iter().cloned());
        token = out.next_token().map(str::to_owned);
        if token.is_none() {
            break;
        }
    }
    let mut tasks = Vec::new();
    for chunk in arns.chunks(DESCRIBE_TASKS_BATCH) {
        let out = call(
            st,
            profile,
            region,
            ecs.describe_tasks().cluster(cluster).set_tasks(Some(chunk.to_vec())).send(),
        )
        .await?;
        tasks.extend(out.tasks().iter().map(task_model));
    }
    sort_tasks(&mut tasks, status == DesiredStatus::Stopped);
    Ok(tasks)
}

/// Newest first: by `stoppedAt` for stopped tasks, else by `startedAt`. Tasks with no time go last.
fn sort_tasks(tasks: &mut [Task], stopped: bool) {
    let key = |t: &Task| if stopped { t.stopped_at } else { t.started_at };
    tasks.sort_by_key(|t| std::cmp::Reverse(key(t)));
}

pub async fn fetch_task(st: &AppState, profile: &str, region: &str, cluster: &str, task_arn: &str) -> AppResult<Task> {
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let out = call(st, profile, region, ecs.describe_tasks().cluster(cluster).tasks(task_arn).send()).await?;
    out.tasks()
        .first()
        .map(task_model)
        .ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("Task {task_arn} not found in {cluster}.")))
}

pub async fn fetch_task_definition(st: &AppState, profile: &str, region: &str, task_definition: &str) -> AppResult<Value> {
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let out = call(st, profile, region, ecs.describe_task_definition().task_definition(task_definition).send()).await?;
    let td = out
        .task_definition()
        .ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("Task definition {task_definition} not found.")))?;
    Ok(task_definition_json(td))
}

pub async fn fetch_task_definition_revisions(
    st: &AppState,
    profile: &str,
    region: &str,
    family: &str,
) -> AppResult<Vec<String>> {
    let ecs = st.clients.get(profile, region).await.ecs.clone();
    let out = call(
        st,
        profile,
        region,
        ecs.list_task_definitions().family_prefix(family).sort(SortOrder::Desc).max_results(20).send(),
    )
    .await?;
    Ok(out
        .task_definition_arns()
        .iter()
        .map(|a| convert::task_def_short(a))
        // The family prefix also matches longer family names, so keep exact matches only.
        .filter(|s| s.rsplit_once(':').is_some_and(|(f, _)| f == family))
        .collect())
}

fn strings(v: &[String]) -> Value {
    json!(v)
}

fn container_json(c: &ContainerDefinition) -> Value {
    let env: Vec<Value> = c.environment().iter().map(|kv| json!({"name": kv.name(), "value": kv.value()})).collect();
    let secrets: Vec<Value> =
        c.secrets().iter().map(|s| json!({"name": s.name(), "valueFrom": s.value_from()})).collect();
    let ports: Vec<Value> = c
        .port_mappings()
        .iter()
        .map(|p| {
            json!({
                "name": p.name(),
                "containerPort": p.container_port(),
                "hostPort": p.host_port(),
                "protocol": p.protocol().map(|x| x.as_str()),
                "appProtocol": p.app_protocol().map(|x| x.as_str()),
            })
        })
        .collect();
    let log = c.log_configuration().map(|l| {
        json!({
            "logDriver": l.log_driver().as_str(),
            "options": l.options().map(|o| o.iter().collect::<std::collections::BTreeMap<_, _>>()),
        })
    });
    let health = c.health_check().map(|h| {
        json!({
            "command": strings(h.command()),
            "interval": h.interval(),
            "timeout": h.timeout(),
            "retries": h.retries(),
            "startPeriod": h.start_period(),
        })
    });
    json!({
        "name": c.name(),
        "image": c.image(),
        "essential": c.essential(),
        "cpu": c.cpu(),
        "memory": c.memory(),
        "portMappings": ports,
        "environment": env,
        "secrets": secrets,
        "logConfiguration": log,
        "healthCheck": health,
        "command": strings(c.command()),
        "entryPoint": strings(c.entry_point()),
    })
}

fn task_definition_json(td: &TaskDefinition) -> Value {
    let mut m = Map::new();
    m.insert("family".into(), json!(td.family()));
    m.insert("revision".into(), json!(td.revision()));
    m.insert("taskDefinitionArn".into(), json!(td.task_definition_arn()));
    m.insert("networkMode".into(), json!(td.network_mode().map(|n| n.as_str())));
    m.insert(
        "requiresCompatibilities".into(),
        json!(td.requires_compatibilities().iter().map(|c| c.as_str()).collect::<Vec<_>>()),
    );
    m.insert("cpu".into(), json!(td.cpu()));
    m.insert("memory".into(), json!(td.memory()));
    m.insert("executionRoleArn".into(), json!(td.execution_role_arn()));
    m.insert("taskRoleArn".into(), json!(td.task_role_arn()));
    m.insert(
        "containerDefinitions".into(),
        Value::Array(td.container_definitions().iter().map(container_json).collect()),
    );
    Value::Object(m)
}

pub struct HealthInput<'a> {
    pub primary_rollout: Option<&'a str>,
    pub deployment_count: usize,
    pub desired: i32,
    pub running: i32,
    /// Service events, newest first.
    pub events: &'a [ServiceEvent],
    pub now_ms: i64,
}

/// Events older than this do not count as "recent" for the crash-loop check.
const RECENT_EVENT_MS: i64 = 15 * 60 * 1000;

pub fn service_health(h: &HealthInput) -> ServiceHealth {
    if h.primary_rollout == Some("FAILED") || (h.desired > 0 && h.running == 0) || crash_looping(h) {
        ServiceHealth::Failing
    } else if h.deployment_count > 1 || h.primary_rollout == Some("IN_PROGRESS") {
        ServiceHealth::Deploying
    } else if h.running < h.desired {
        ServiceHealth::Degraded
    } else {
        ServiceHealth::Healthy
    }
}

/// True when recent events show tasks that start and stop again and again.
/// A deployment also stops tasks, so stop counts apply only with one deployment.
fn crash_looping(h: &HealthInput) -> bool {
    let recent: Vec<&str> = h
        .events
        .iter()
        .take(10)
        .filter(|e| e.created_at.is_some_and(|t| h.now_ms - t <= RECENT_EVENT_MS))
        .map(|e| e.message.as_str())
        .collect();
    if recent.iter().any(|m| m.contains("unable to consistently start tasks")) {
        return true;
    }
    let stops = recent.iter().filter(|m| m.contains("has stopped")).count();
    let starts = recent.iter().filter(|m| m.contains("has started")).count();
    h.deployment_count <= 1 && stops >= 3 && starts >= 2
}

#[tauri::command]
pub async fn list_clusters(state: State<'_, AppState>, profile: String, region: String) -> AppResult<Vec<ClusterSummary>> {
    fetch_clusters(&state, &profile, &region).await
}

#[tauri::command]
pub async fn list_services(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
) -> AppResult<Vec<ServiceSummary>> {
    fetch_services(&state, &profile, &region, &cluster).await
}

#[tauri::command]
pub async fn get_service(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
    service: String,
) -> AppResult<ServiceDetail> {
    fetch_service(&state, &profile, &region, &cluster, &service).await
}

/// `desired_status` is "RUNNING" or "STOPPED".
#[tauri::command]
pub async fn list_tasks(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
    service: Option<String>,
    desired_status: String,
) -> AppResult<Vec<Task>> {
    fetch_tasks(&state, &profile, &region, &cluster, service.as_deref(), &desired_status).await
}

#[tauri::command]
pub async fn get_task(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
    task_arn: String,
) -> AppResult<Task> {
    fetch_task(&state, &profile, &region, &cluster, &task_arn).await
}

#[tauri::command]
pub async fn get_task_definition(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    task_definition: String,
) -> AppResult<serde_json::Value> {
    fetch_task_definition(&state, &profile, &region, &task_definition).await
}

/// Newest first, as "family:revision".
#[tauri::command]
pub async fn list_task_definition_revisions(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    family: String,
) -> AppResult<Vec<String>> {
    fetch_task_definition_revisions(&state, &profile, &region, &family).await
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_700_000_000_000;

    fn ev(age_secs: i64, msg: &str) -> ServiceEvent {
        ServiceEvent { id: String::new(), created_at: Some(NOW - age_secs * 1000), message: msg.into() }
    }

    fn input<'a>(rollout: Option<&'a str>, deps: usize, desired: i32, running: i32, events: &'a [ServiceEvent]) -> HealthInput<'a> {
        HealthInput { primary_rollout: rollout, deployment_count: deps, desired, running, events, now_ms: NOW }
    }

    #[test]
    fn health_rules() {
        let none: [ServiceEvent; 0] = [];
        assert_eq!(service_health(&input(Some("COMPLETED"), 1, 2, 2, &none)), ServiceHealth::Healthy);
        assert_eq!(service_health(&input(Some("FAILED"), 1, 2, 2, &none)), ServiceHealth::Failing);
        assert_eq!(service_health(&input(None, 1, 2, 0, &none)), ServiceHealth::Failing);
        assert_eq!(service_health(&input(None, 1, 0, 0, &none)), ServiceHealth::Healthy);
        assert_eq!(service_health(&input(Some("IN_PROGRESS"), 1, 2, 2, &none)), ServiceHealth::Deploying);
        assert_eq!(service_health(&input(Some("COMPLETED"), 2, 2, 1, &none)), ServiceHealth::Deploying);
        assert_eq!(service_health(&input(Some("COMPLETED"), 1, 3, 2, &none)), ServiceHealth::Degraded);
    }

    #[test]
    fn crash_loop_is_failing() {
        let loop_events = [
            ev(10, "(service web) has started 1 tasks: (task a)."),
            ev(40, "(service web) has stopped 1 running tasks: (task b)."),
            ev(70, "(service web) has started 1 tasks: (task b)."),
            ev(100, "(service web) has stopped 1 running tasks: (task c)."),
            ev(130, "(service web) has stopped 1 running tasks: (task d)."),
        ];
        assert_eq!(service_health(&input(Some("COMPLETED"), 1, 2, 2, &loop_events)), ServiceHealth::Failing);
        // During a deployment, stops are normal.
        assert_eq!(service_health(&input(Some("IN_PROGRESS"), 2, 2, 2, &loop_events)), ServiceHealth::Deploying);

        let old: Vec<ServiceEvent> = loop_events.iter().map(|e| ev(3600, &e.message)).collect();
        assert_eq!(service_health(&input(Some("COMPLETED"), 1, 2, 2, &old)), ServiceHealth::Healthy);

        let unable = [ev(5, "(service web) is unable to consistently start tasks successfully.")];
        assert_eq!(service_health(&input(None, 2, 2, 2, &unable)), ServiceHealth::Failing);
    }

    #[test]
    fn tasks_sort_newest_first() {
        let mk = |id: &str, started: Option<i64>, stopped: Option<i64>| Task {
            arn: id.into(),
            id: id.into(),
            cluster_name: String::new(),
            service_name: None,
            last_status: String::new(),
            desired_status: String::new(),
            health_status: None,
            task_definition: String::new(),
            revision: None,
            availability_zone: None,
            private_ip: None,
            cpu: None,
            memory: None,
            started_at: started,
            stopped_at: stopped,
            stop_reason: None,
            stop_code: None,
            launch_type: None,
            enable_execute_command: false,
            containers: vec![],
        };
        let mut t = vec![mk("a", Some(1), Some(30)), mk("b", Some(3), Some(10)), mk("c", None, None)];
        sort_tasks(&mut t, false);
        assert_eq!(t.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["b", "a", "c"]);
        sort_tasks(&mut t, true);
        assert_eq!(t.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
    }
}

