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

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn watch_id(t: &ServiceRef) -> String {
    format!("{}/{}/{}/{}", t.profile, t.region, t.cluster, t.service)
}

fn primary(deployments: &[Deployment]) -> Option<&Deployment> {
    deployments.iter().find(|d| d.status == "PRIMARY").or_else(|| deployments.first())
}

fn is_rollback_event(message: &str) -> bool {
    let m = message.to_ascii_lowercase();
    m.contains("circuit breaker") || m.contains("rolling back") || m.contains("rolled back")
}

pub struct PhaseInput<'a> {
    pub watched_id: Option<&'a str>,
    pub deployments: &'a [Deployment],
    /// Service events since the watch started.
    pub events: &'a [ServiceEvent],
    pub elapsed: Duration,
    pub cancelled: bool,
}

/// Decides the phase of a watch from the current service state.
pub fn decide_phase(p: &PhaseInput) -> WatchPhase {
    if p.cancelled {
        return WatchPhase::Cancelled;
    }
    let watched = match p.watched_id {
        Some(id) => p.deployments.iter().find(|d| d.id == id),
        None => primary(p.deployments),
    };
    let current_primary = p.deployments.iter().find(|d| d.status == "PRIMARY");
    match watched {
        Some(w) if w.status == "PRIMARY" => match w.rollout_state.as_deref() {
            Some("FAILED") => return WatchPhase::Failed,
            // A scale keeps the state COMPLETED, so the counts must also match.
            Some("COMPLETED") if w.running == w.desired && w.pending == 0 => return WatchPhase::Completed,
            None if p.deployments.len() == 1 && w.running == w.desired => return WatchPhase::Completed,
            _ => {}
        },
        _ => {
            let replaced = current_primary.is_some_and(|d| Some(d.id.as_str()) != watched.map(|w| w.id.as_str()));
            if replaced || p.events.iter().any(|e| is_rollback_event(&e.message)) {
                return WatchPhase::RolledBack;
            }
            if watched.is_some_and(|w| w.rollout_state.as_deref() == Some("FAILED")) {
                return WatchPhase::Failed;
            }
        }
    }
    if p.elapsed >= TIMEOUT {
        return WatchPhase::TimedOut;
    }
    WatchPhase::InProgress
}

fn task_def_name(td: &str) -> &str {
    td.rsplit('/').next().unwrap_or(td)
}

/// One plain sentence for a finished watch.
pub fn final_message(phase: WatchPhase, w: &DeployWatch, reason: Option<&str>) -> String {
    let td = task_def_name(&w.task_definition);
    match phase {
        WatchPhase::Completed => format!("{td} is running on {} of {} tasks.", w.running, w.desired),
        WatchPhase::Failed => match reason.filter(|r| !r.is_empty()) {
            Some(r) => format!("The rollout of {td} failed: {}", r.trim_end_matches('.').to_owned() + "."),
            None => format!("The rollout of {td} failed with {} failed tasks.", w.failed),
        },
        WatchPhase::RolledBack => format!("ECS rolled back or replaced the deployment of {td}."),
        WatchPhase::TimedOut => format!("The rollout of {td} did not finish in 60 minutes."),
        WatchPhase::Cancelled => "You stopped watching this rollout.".into(),
        WatchPhase::InProgress => String::new(),
    }
}

/// Copies counts from the watched deployment and adds new events.
fn apply_service(w: &mut DeployWatch, detail: &ServiceDetail) {
    let deps = &detail.service.deployments;
    let watched = match &w.deployment_id {
        Some(id) => deps.iter().find(|d| &d.id == id),
        None => primary(deps),
    };
    if let Some(d) = watched {
        w.desired = d.desired;
        w.running = d.running;
        w.pending = d.pending;
        w.failed = d.failed;
    }
    w.events = merge_events(&w.events, &detail.events, w.started_at);
}

/// Newest first, deduped by id, only events at or after `since`.
pub fn merge_events(old: &[ServiceEvent], new: &[ServiceEvent], since: i64) -> Vec<ServiceEvent> {
    let mut out: Vec<ServiceEvent> = old.to_vec();
    for e in new {
        if e.created_at.is_some_and(|t| t >= since) && !out.iter().any(|o| o.id == e.id) {
            out.push(e.clone());
        }
    }
    out.sort_by_key(|e| std::cmp::Reverse(e.created_at));
    out.truncate(MAX_EVENTS);
    out
}

/// Stopped tasks of the watched task definition. Tasks that started before `started_after` are old tasks that a rollout or scale-in replaced.
pub fn pick_failed_tasks(tasks: &[Task], task_definition: &str, since: i64, started_after: i64) -> Vec<Task> {
    let mut out: Vec<Task> = tasks
        .iter()
        .filter(|t| t.task_definition == task_definition)
        .filter(|t| t.stopped_at.is_some_and(|s| s >= since))
        .filter(|t| t.started_at.is_none_or(|s| s >= started_after))
        .cloned()
        .collect();
    out.sort_by_key(|t| std::cmp::Reverse(t.stopped_at));
    out.truncate(MAX_FAILED_TASKS);
    out
}

type ProgressKey = (WatchPhase, i32, i32, i32, i32, Vec<String>, Vec<String>);

fn progress_key(w: &DeployWatch) -> ProgressKey {
    (
        w.phase,
        w.desired,
        w.running,
        w.pending,
        w.failed,
        w.events.iter().map(|e| e.id.clone()).collect(),
        w.failed_tasks.iter().map(|t| t.arn.clone()).collect(),
    )
}

fn notify(app: &AppHandle, w: &DeployWatch) {
    let verb = match w.phase {
        WatchPhase::Completed => "completed",
        WatchPhase::Failed => "failed",
        WatchPhase::RolledBack => "rolled back",
        WatchPhase::TimedOut => "timed out",
        _ => return,
    };
    let title = format!("{} rollout {verb}", w.target.service);
    let body = format!("{} of {} tasks running, {} failed. {}", w.running, w.desired, w.failed, w.message.as_deref().unwrap_or(""));
    if let Err(e) = app.notification().builder().title(title).body(body.trim_end()).show() {
        log::warn!("could not show notification for {}: {e}", w.id);
    }
}

async fn run(app: AppHandle, id: String, generation: u64, deploy_created_at: i64) {
    let state = app.state::<AppState>();
    let start = Instant::now();
    let mut last_tasks: Option<Instant> = None;
    loop {
        tokio::time::sleep(POLL_EVERY).await;
        let Some(mut w) = state.watches.snapshot(&id, generation) else { return };
        if w.phase != WatchPhase::InProgress {
            return;
        }
        let before = progress_key(&w);
        let t = w.target.clone();
        let mut reason = None;
        let mut deployments = Vec::new();
        match fetch_service(&state, &t.profile, &t.region, &t.cluster, &t.service).await {
            Ok(detail) => {
                apply_service(&mut w, &detail);
                deployments = detail.service.deployments;
            }
            Err(e) => log::warn!("deploy watch {id}: {}", e.message),
        }
        if last_tasks.is_none_or(|l| l.elapsed() >= TASKS_EVERY) {
            last_tasks = Some(Instant::now());
            match fetch_tasks(&state, &t.profile, &t.region, &t.cluster, Some(&t.service), "STOPPED").await {
                Ok(tasks) => {
                    w.failed_tasks = pick_failed_tasks(&tasks, &w.task_definition, w.started_at, deploy_created_at)
                }
                Err(e) => log::warn!("deploy watch {id}: {}", e.message),
            }
        }
        // Without fresh deployments, only the timeout can end the watch.
        let phase = if deployments.is_empty() {
            if start.elapsed() >= TIMEOUT { WatchPhase::TimedOut } else { WatchPhase::InProgress }
        } else {
            decide_phase(&PhaseInput {
                watched_id: w.deployment_id.as_deref(),
                deployments: &deployments,
                events: &w.events,
                elapsed: start.elapsed(),
                cancelled: false,
            })
        };
        if phase == WatchPhase::Failed {
            reason = deployments
                .iter()
                .find(|d| Some(&d.id) == w.deployment_id.as_ref())
                .and_then(|d| d.rollout_reason.clone());
        }
        w.phase = phase;
        let done = phase != WatchPhase::InProgress;
        if done {
            w.finished_at = Some(now_ms());
            w.message = Some(final_message(phase, &w, reason.as_deref()));
        }
        if progress_key(&w) == before {
            continue;
        }
        w.updated_at = now_ms();
        if !state.watches.store(generation, &w) {
            return;
        }
        let _ = app.emit(events::DEPLOY_WATCH, &w);
        if done {
            notify(&app, &w);
            return;
        }
    }
}

