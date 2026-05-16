//! CloudWatch Logs live tail and search. Emits `logs://lines`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use aws_sdk_cloudwatchlogs::operation::start_live_tail::StartLiveTailOutput;
use aws_sdk_cloudwatchlogs::types::StartLiveTailResponseStream;
use aws_sdk_ecs::types::LogDriver;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

use crate::error::{aws_err, AppError, AppResult};
use crate::models::{events, LogBatch, LogLine, LogTarget};
use crate::ops::fail;
use crate::state::AppState;

/// StartLiveTail accepts at most 10 log groups per session.
const MAX_TAIL_GROUPS: usize = 10;
const FLUSH_EVERY: Duration = Duration::from_millis(250);
const FLUSH_LINES: usize = 200;
const DEFAULT_SEARCH_LIMIT: i32 = 500;
const MAX_SEARCH_PAGES: usize = 50;

#[derive(Default)]
pub struct TailRegistry {
    /// session_id → (generation, task). The generation stops an old task from acting for a new one.
    tails: std::sync::Mutex<HashMap<String, (u64, JoinHandle<()>)>>,
    next_gen: AtomicU64,
    /// profile → AWS account ID, from STS GetCallerIdentity.
    accounts: tokio::sync::Mutex<HashMap<String, String>>,
}

impl TailRegistry {
    fn insert(&self, session_id: String, generation: u64, handle: JoinHandle<()>) {
        let old = self.tails.lock().unwrap().insert(session_id, (generation, handle));
        if let Some((_, h)) = old {
            h.abort();
        }
    }

    fn is_current(&self, session_id: &str, generation: u64) -> bool {
        self.tails.lock().unwrap().get(session_id).is_some_and(|(g, _)| *g == generation)
    }

    fn remove(&self, session_id: &str) {
        if let Some((_, h)) = self.tails.lock().unwrap().remove(session_id) {
            h.abort();
        }
    }
}

/// Guesses a log level. JSON level fields win over words in the text.
pub fn guess_level(message: &str) -> &'static str {
    if let Some(level) = json_level(message) {
        return level;
    }
    let m = message.to_ascii_lowercase();
    if ["error", "exception", "fatal", "panic"].iter().any(|w| m.contains(w)) {
        "ERROR"
    } else if m.contains("warn") {
        "WARN"
    } else if m.contains("debug") || m.contains("trace") {
        "DEBUG"
    } else {
        "INFO"
    }
}

fn json_level(message: &str) -> Option<&'static str> {
    let trimmed = message.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = v.as_object()?;
    let raw = ["level", "severity", "lvl", "levelname", "log.level", "loglevel"]
        .iter()
        .find_map(|k| obj.get(*k))?;
    let text = match raw {
        serde_json::Value::String(s) => s.to_ascii_lowercase(),
        // Pino and Bunyan use numbers: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
        serde_json::Value::Number(n) => {
            return n.as_i64().map(|n| match n {
                i64::MIN..=29 => "DEBUG",
                30..=39 => "INFO",
                40..=49 => "WARN",
                _ => "ERROR",
            })
        }
        _ => return None,
    };
    match text.as_str() {
        "error" | "err" | "fatal" | "critical" | "crit" | "panic" | "alert" | "emerg" | "emergency" => Some("ERROR"),
        "warn" | "warning" => Some("WARN"),
        "debug" | "trace" | "verbose" => Some("DEBUG"),
        "info" | "information" | "notice" => Some("INFO"),
        _ => None,
    }
}

