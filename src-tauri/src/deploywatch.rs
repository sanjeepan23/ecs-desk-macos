//! Follows a rollout to the end. Emits `deploy://watch` and a desktop notification.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::ecs::{fetch_service, fetch_tasks};
use crate::error::AppResult;
use crate::models::{events, DeployWatch, Deployment, ServiceDetail, ServiceEvent, ServiceRef, Task, WatchPhase};
use crate::state::AppState;

const POLL_EVERY: Duration = Duration::from_secs(5);
const TASKS_EVERY: Duration = Duration::from_secs(15);
const TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Finished watches stay in the registry for this long, in ms.
const KEEP_FINISHED_MS: i64 = 30 * 60 * 1000;
const MAX_FAILED_TASKS: usize = 10;
const MAX_EVENTS: usize = 100;
/// A watch on an older deployment (for example after a scale) also shows events from this far back, in ms.
const EVENT_LOOKBACK_MS: i64 = 30 * 1000;

struct Entry {
    watch: DeployWatch,
    generation: u64,
    handle: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct WatchRegistry {
    entries: Mutex<HashMap<String, Entry>>,
    next_gen: AtomicU64,
}

impl WatchRegistry {
    fn prune(map: &mut HashMap<String, Entry>, now: i64) {
        map.retain(|_, e| e.watch.finished_at.is_none_or(|f| now - f < KEEP_FINISHED_MS));
    }

    fn running(&self, id: &str) -> Option<DeployWatch> {
        let map = self.entries.lock().unwrap();
        map.get(id).filter(|e| e.watch.phase == WatchPhase::InProgress).map(|e| e.watch.clone())
    }

    fn insert(&self, watch: DeployWatch) -> u64 {
        let generation = self.next_gen.fetch_add(1, Ordering::Relaxed);
        let mut map = self.entries.lock().unwrap();
        Self::prune(&mut map, now_ms());
        let old = map.insert(watch.id.clone(), Entry { watch, generation, handle: None });
        if let Some(h) = old.and_then(|e| e.handle) {
            h.abort();
        }
        generation
    }

    fn set_handle(&self, id: &str, generation: u64, handle: JoinHandle<()>) {
        let mut map = self.entries.lock().unwrap();
        match map.get_mut(id) {
            Some(e) if e.generation == generation => e.handle = Some(handle),
            _ => handle.abort(),
        }
    }

    fn snapshot(&self, id: &str, generation: u64) -> Option<DeployWatch> {
        let map = self.entries.lock().unwrap();
        map.get(id).filter(|e| e.generation == generation).map(|e| e.watch.clone())
    }

    /// Saves the watch. Returns false when a newer watch or an unwatch replaced this one.
    fn store(&self, generation: u64, watch: &DeployWatch) -> bool {
        let mut map = self.entries.lock().unwrap();
        match map.get_mut(&watch.id) {
            Some(e) if e.generation == generation && e.watch.phase == WatchPhase::InProgress => {
                e.watch = watch.clone();
                if watch.phase != WatchPhase::InProgress {
                    // The task ends by itself. Dropping the handle does not abort it.
                    e.handle = None;
                }
                true
            }
            _ => false,
        }
    }

    fn list(&self) -> Vec<DeployWatch> {
        let mut map = self.entries.lock().unwrap();
        Self::prune(&mut map, now_ms());
        let mut list: Vec<DeployWatch> = map.values().map(|e| e.watch.clone()).collect();
        list.sort_by_key(|w| std::cmp::Reverse(w.started_at));
        list
    }

    /// Stops the task and marks a running watch as cancelled.
    fn cancel(&self, id: &str) -> Option<DeployWatch> {
        let mut map = self.entries.lock().unwrap();
        let e = map.get_mut(id)?;
        if let Some(h) = e.handle.take() {
            h.abort();
        }
        if e.watch.phase != WatchPhase::InProgress {
            return None;
        }
        let now = now_ms();
        e.watch.phase = WatchPhase::Cancelled;
        e.watch.finished_at = Some(now);
        e.watch.updated_at = now;
        e.watch.message = Some(final_message(WatchPhase::Cancelled, &e.watch, None));
        Some(e.watch.clone())
    }
}

