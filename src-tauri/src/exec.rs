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

