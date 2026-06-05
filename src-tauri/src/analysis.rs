//! Groups the stopped tasks of a service by cause and gives advice for each cause.

use std::collections::BTreeMap;

use tauri::State;

use crate::error::AppResult;
use crate::models::{StopCategory, StopGroup, StoppedAnalysis, Task};
use crate::state::AppState;

const MAX_ARNS: usize = 20;
const CRASH_LOOP_WINDOW_MS: i64 = 15 * 60 * 1000;
const CRASH_LOOP_STOPS: usize = 3;

#[tauri::command]
pub async fn analyze_stopped_tasks(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
    service: String,
) -> AppResult<StoppedAnalysis> {
    let tasks = crate::ecs::fetch_tasks(&state, &profile, &region, &cluster, Some(&service), "STOPPED").await?;
    Ok(analyze(&tasks, chrono::Utc::now().timestamp_millis()))
}

/// All reason text of a task in lower case: the stop reason and each container reason.
fn reason_text(task: &Task) -> String {
    let mut parts: Vec<&str> = task.stop_reason.iter().map(String::as_str).collect();
    parts.extend(task.containers.iter().filter_map(|c| c.reason.as_deref()));
    parts.join(" | ").to_ascii_lowercase()
}

fn has_word(text: &str, word: &str) -> bool {
    text.split(|c: char| !c.is_ascii_alphanumeric()).any(|w| w == word)
}

/// The cause of one stopped task. Specific causes win over the generic stop code.
pub fn classify(task: &Task) -> StopCategory {
    let text = reason_text(task);
    let code = task.stop_code.as_deref().unwrap_or("");
    let has = |s: &str| text.contains(s);

    if code == "SpotInterruption" || code == "TerminationNotice" || has("spot interruption") {
        return StopCategory::SpotInterruption;
    }
    let exit_137 = task.containers.iter().any(|c| c.exit_code == Some(137));
    if has("outofmemory") || has("oomkilled") || (exit_137 && (has_word(&text, "oom") || has("memory"))) {
        return StopCategory::OutOfMemory;
    }
    if has("cannotpullcontainer") || has("pull image") || has("pull access denied") || has("manifest unknown") {
        return StopCategory::ImagePull;
    }
    if has("resourceinitializationerror")
        && (has("secret") || has("ssm") || has("parameter") || has("kms"))
    {
        return StopCategory::Secrets;
    }
    if has("health check") {
        return StopCategory::HealthCheck;
    }
    if has("resource:") || has("no container instances") || has("capacity provider") || has("insufficient capacity") {
        return StopCategory::Capacity;
    }
    if has_word(&text, "eni")
        || has("subnet")
        || has("network interface")
        || (has("cannotstartcontainererror") && has("network"))
        || (has("resourceinitializationerror") && has("network"))
    {
        return StopCategory::Network;
    }
    if has("ecs deployment") || has("initiated by (deployment") || has("initiated by deployment") {
        return StopCategory::Deployment;
    }
    if has("scaling activity initiated by")
        || (code == "ServiceSchedulerInitiated" && (has("scale-in") || has("scale in") || has("scaling")))
    {
        return StopCategory::ScaleIn;
    }
    if code == "UserInitiated" {
        return StopCategory::UserStopped;
    }
    if code == "EssentialContainerExited" || has("essential container in task exited") {
        return StopCategory::EssentialExit;
    }
    StopCategory::Other
}

fn title(c: StopCategory) -> &'static str {
    match c {
        StopCategory::OutOfMemory => "Out of memory",
        StopCategory::HealthCheck => "Failed health checks",
        StopCategory::ImagePull => "Image pull failed",
        StopCategory::Secrets => "Secrets did not load",
        StopCategory::EssentialExit => "Essential container exited",
        StopCategory::Capacity => "No capacity",
        StopCategory::Network => "Network setup failed",
        StopCategory::SpotInterruption => "Spot interruption",
        StopCategory::Deployment => "Replaced by a deployment",
        StopCategory::ScaleIn => "Scale-in",
        StopCategory::UserStopped => "Stopped by a user",
        StopCategory::Other => "Other",
    }
}

fn advice(c: StopCategory) -> &'static str {
    match c {
        StopCategory::OutOfMemory => {
            "The container used all of its memory. Raise the task or container memory, or find the leak; the Metrics tab shows the trend."
        }
        StopCategory::HealthCheck => {
            "The load balancer or container health check failed. Check the health check path, port, and grace period, and read the logs from the start of the task."
        }
        StopCategory::ImagePull => {
            "ECS could not pull the image. Check that the image tag exists and that the execution role and network can reach the registry."
        }
        StopCategory::Secrets => {
            "ECS could not read a secret or parameter. Check the ARN and that the execution role can read it and decrypt it with KMS."
        }
        StopCategory::EssentialExit => {
            "An essential container exited, so ECS stopped the task. Read the container logs near the stop time and check the exit code."
        }
        StopCategory::Capacity => {
            "ECS found no capacity to place the task. Check the capacity provider, the cluster instances, and the CPU and memory the task asks for."
        }
        StopCategory::Network => {
            "The task network did not start. Check for free IP addresses in the subnets and for ENI limits."
        }
        StopCategory::SpotInterruption => {
            "AWS took back the Spot capacity. Add on-demand capacity to the strategy if the service cannot lose tasks."
        }
        StopCategory::Deployment => "A deployment replaced these tasks. This is normal.",
        StopCategory::ScaleIn => "The service scaled in and stopped these tasks. This is normal.",
        StopCategory::UserStopped => "A user or an API call stopped these tasks.",
        StopCategory::Other => "Open a task to read the full stop reason and container exit codes.",
    }
}

