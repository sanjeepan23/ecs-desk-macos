//! Write actions. Each one calls `state.guard_write` first.

use tauri::State;

use crate::convert;
use crate::error::{AppError, AppResult};
use crate::models::{ServiceRef, ServiceSummary, Task, TaskRef};
use crate::ops::fail;
use crate::state::AppState;

const MAX_DESIRED: i32 = 1000;
const DEFAULT_STOP_REASON: &str = "Stopped from ECS Desk";

#[tauri::command]
pub async fn force_deploy(state: State<'_, AppState>, target: ServiceRef) -> AppResult<ServiceSummary> {
    state.guard_write(&target.profile).await?;
    update_service(&state, &target, |b| b.force_new_deployment(true)).await
}

#[tauri::command]
pub async fn scale_service(state: State<'_, AppState>, target: ServiceRef, desired: i32) -> AppResult<ServiceSummary> {
    state.guard_write(&target.profile).await?;
    validate_desired(desired)?;
    update_service(&state, &target, |b| b.desired_count(desired)).await
}

/// `task_definition` is "family:revision" or a full ARN.
#[tauri::command]
pub async fn rollback_service(
    state: State<'_, AppState>,
    target: ServiceRef,
    task_definition: String,
) -> AppResult<ServiceSummary> {
    state.guard_write(&target.profile).await?;
    let td = task_definition.trim().to_owned();
    if td.is_empty() {
        return Err(AppError::invalid("Give a task definition to roll back to."));
    }
    update_service(&state, &target, |b| b.task_definition(td)).await
}

#[tauri::command]
pub async fn stop_task(state: State<'_, AppState>, target: TaskRef, reason: Option<String>) -> AppResult<Task> {
    state.guard_write(&target.profile).await?;
    let reason = reason
        .map(|r| r.trim().to_owned())
        .filter(|r| !r.is_empty())
        .unwrap_or_else(|| DEFAULT_STOP_REASON.to_owned());
    let ctx = state.clients.get(&target.profile, &target.region).await;
    state.limiter.acquire(&target.profile, &target.region).await;
    let out = ctx
        .ecs
        .stop_task()
        .cluster(&target.cluster)
        .task(&target.task_arn)
        .reason(reason)
        .send()
        .await;
    let out = match out {
        Ok(o) => o,
        Err(e) => return Err(fail(&state, &target.profile, &target.region, e).await),
    };
    out.task()
        .map(convert::task_model)
        .ok_or_else(|| AppError::internal("StopTask returned no task."))
}

