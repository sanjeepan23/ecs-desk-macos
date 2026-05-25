//! ECS Exec through session-manager-plugin in a PTY. Emits `exec://output` and `exec://exit`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use aws_sdk_ecs::types::ManagedAgentName;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{events, ExecCheck, ExecExit, ExecOutput, ExecStart};
use crate::ops::{fail, short_name};
use crate::state::AppState;

const PLUGIN: &str = "session-manager-plugin";
const PLUGIN_DIRS: [&str; 3] = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/local/sessionmanagerplugin/bin"];
const DEFAULT_COMMAND: &str = "/bin/sh";

struct ExecSession {
    generation: u64,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct ExecRegistry {
    sessions: Mutex<HashMap<String, ExecSession>>,
    next_gen: AtomicU64,
}

impl ExecRegistry {
    fn insert(&self, session_id: String, session: ExecSession) {
        let old = self.sessions.lock().unwrap().insert(session_id, session);
        if let Some(mut s) = old {
            let _ = s.killer.kill();
        }
    }

    /// Removes the session only when it is still the given generation.
    fn remove_if(&self, session_id: &str, generation: u64) {
        let mut map = self.sessions.lock().unwrap();
        if map.get(session_id).is_some_and(|s| s.generation == generation) {
            map.remove(session_id);
        }
    }

    fn with<T>(&self, session_id: &str, f: impl FnOnce(&mut ExecSession) -> AppResult<T>) -> AppResult<T> {
        let mut map = self.sessions.lock().unwrap();
        let s = map
            .get_mut(session_id)
            .ok_or_else(|| AppError::new(crate::error::ErrorKind::NotFound, "The exec session has ended."))?;
        f(s)
    }
}

fn find_plugin() -> Option<PathBuf> {
    if let Ok(p) = which::which(PLUGIN) {
        return Some(p);
    }
    PLUGIN_DIRS.iter().map(|d| Path::new(d).join(PLUGIN)).find(|p| p.is_file())
}

/// Facts about one task and container that decide if exec can work.
#[derive(Debug, Default)]
struct TaskFacts {
    found: bool,
    exec_enabled: bool,
    last_status: Option<String>,
    container_found: bool,
    agent_status: Option<String>,
    runtime_id: Option<String>,
}

fn problems(f: &TaskFacts, container: &str, plugin: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    if !f.found {
        out.push("The task was not found. It may have stopped.".to_owned());
    } else {
        if !f.exec_enabled {
            out.push("Turn on enableExecuteCommand for the service, then start new tasks.".to_owned());
        }
        match f.last_status.as_deref() {
            Some("RUNNING") => {}
            s => out.push(format!("The task is not running (status {}).", s.unwrap_or("unknown"))),
        }
        if !f.container_found {
            out.push(format!("The task has no container named {container}."));
        } else if f.exec_enabled {
            match f.agent_status.as_deref() {
                Some("RUNNING") => {}
                None => out.push("The ECS Exec agent is not present in the container.".to_owned()),
                Some(s) => out.push(format!("The ECS Exec agent in the container is not running (status {s}).")),
            }
        }
    }
    if plugin.is_none() {
        out.push(format!("Install the AWS Session Manager plugin ({PLUGIN}); it was not found on this machine."));
    }
    out
}

async fn task_facts(state: &AppState, profile: &str, region: &str, cluster: &str, task_arn: &str, container: &str) -> AppResult<TaskFacts> {
    let ctx = state.clients.get(profile, region).await;
    state.limiter.acquire(profile, region).await;
    let out = match ctx.ecs.describe_tasks().cluster(cluster).tasks(task_arn).send().await {
        Ok(o) => o,
        Err(e) => return Err(fail(state, profile, region, e).await),
    };
    let Some(task) = out.tasks().first() else {
        return Ok(TaskFacts::default());
    };
    let c = task.containers().iter().find(|c| c.name() == Some(container));
    let agent = c.and_then(|c| {
        c.managed_agents().iter().find(|a| a.name() == Some(&ManagedAgentName::ExecuteCommandAgent))
    });
    Ok(TaskFacts {
        found: true,
        exec_enabled: task.enable_execute_command(),
        last_status: task.last_status().map(str::to_owned),
        container_found: c.is_some(),
        agent_status: agent.and_then(|a| a.last_status()).map(str::to_owned),
        runtime_id: c.and_then(|c| c.runtime_id()).map(str::to_owned),
    })
}

#[tauri::command]
pub async fn exec_check(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
    task_arn: String,
    container: String,
) -> AppResult<ExecCheck> {
    let facts = task_facts(&state, &profile, &region, &cluster, &task_arn, &container).await?;
    let plugin = find_plugin();
    let problems = problems(&facts, &container, plugin.as_deref());
    Ok(ExecCheck {
        ok: problems.is_empty(),
        problems,
        plugin_path: plugin.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// SSM target for ECS Exec: "ecs:<clusterName>_<taskId>_<containerRuntimeId>".
fn ssm_target(cluster: &str, task_arn: &str, runtime_id: &str) -> String {
    format!("ecs:{}_{}_{}", short_name(cluster), short_name(task_arn), runtime_id)
}

/// Plugin arguments in the same order as the AWS CLI uses.
fn plugin_args(session_id: &str, stream_url: &str, token: &str, region: &str, profile: &str, target: &str) -> Vec<String> {
    let session = serde_json::json!({
        "SessionId": session_id,
        "StreamUrl": stream_url,
        "TokenValue": token,
    });
    let params = serde_json::json!({ "Target": target });
    vec![
        session.to_string(),
        region.to_owned(),
        "StartSession".to_owned(),
        profile.to_owned(),
        params.to_string(),
        format!("https://ssm.{region}.amazonaws.com"),
    ]
}

/// Takes the complete UTF-8 text from `buf`. Incomplete trailing bytes stay in `buf` for the next read.
fn take_utf8(buf: &mut Vec<u8>) -> String {
    let keep = incomplete_tail(buf);
    let tail = buf.split_off(buf.len() - keep);
    let text = String::from_utf8_lossy(buf).into_owned();
    *buf = tail;
    text
}

/// Length of a multi-byte character that is cut off at the end of `b`, or 0.
fn incomplete_tail(b: &[u8]) -> usize {
    for i in 1..=b.len().min(3) {
        let c = b[b.len() - i];
        if c & 0xC0 == 0x80 {
            continue;
        }
        let need = match c {
            0xF0..=0xF7 => 4,
            0xE0..=0xEF => 3,
            0xC0..=0xDF => 2,
            _ => 1,
        };
        return if need > i { i } else { 0 };
    }
    0
}

