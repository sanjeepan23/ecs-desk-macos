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

