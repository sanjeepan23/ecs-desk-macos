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

fn validate_desired(desired: i32) -> AppResult<()> {
    if !(0..=MAX_DESIRED).contains(&desired) {
        return Err(AppError::invalid(format!("Desired count must be from 0 to {MAX_DESIRED}.")));
    }
    Ok(())
}

async fn update_service(
    state: &AppState,
    target: &ServiceRef,
    apply: impl FnOnce(
        aws_sdk_ecs::operation::update_service::builders::UpdateServiceFluentBuilder,
    ) -> aws_sdk_ecs::operation::update_service::builders::UpdateServiceFluentBuilder,
) -> AppResult<ServiceSummary> {
    let ctx = state.clients.get(&target.profile, &target.region).await;
    state.limiter.acquire(&target.profile, &target.region).await;
    let req = ctx.ecs.update_service().cluster(&target.cluster).service(&target.service);
    let out = match apply(req).send().await {
        Ok(o) => o,
        Err(e) => return Err(fail(state, &target.profile, &target.region, e).await),
    };
    out.service()
        .map(convert::service_summary)
        .ok_or_else(|| AppError::internal("UpdateService returned no service."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desired_count_limits() {
        assert!(validate_desired(0).is_ok());
        assert!(validate_desired(1000).is_ok());
        assert!(validate_desired(-1).is_err());
        assert!(validate_desired(1001).is_err());
    }
}
