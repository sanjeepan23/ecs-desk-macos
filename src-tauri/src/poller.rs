//! Adaptive polling of the focused view. Emits `ecs://update` and `ecs://poll-status`.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{watch, Notify};

use crate::ecs;
use crate::error::AppResult;
use crate::models::{events, EcsUpdate, Focus, PollStatus};
use crate::state::AppState;

/// Hashes of the last emitted parts of `EcsUpdate`.
#[derive(Default)]
struct Hashes {
    clusters: Option<u64>,
    services: Option<u64>,
    service_detail: Option<u64>,
    tasks: Option<u64>,
}

pub struct PollerShared {
    focus: watch::Sender<Option<Focus>>,
    wake: Notify,
    /// Set by `refresh_now` so the next tick also reloads clusters and services.
    force_full: AtomicBool,
    status: Mutex<PollStatus>,
    hashes: Mutex<Hashes>,
}

impl Default for PollerShared {
    fn default() -> Self {
        Self {
            focus: watch::channel(None).0,
            wake: Notify::new(),
            force_full: AtomicBool::new(false),
            status: Mutex::new(PollStatus::default()),
            hashes: Mutex::new(Hashes::default()),
        }
    }
}

fn hash_of<T: Serialize>(v: &T) -> u64 {
    let mut h = DefaultHasher::new();
    serde_json::to_string(v).unwrap_or_default().hash(&mut h);
    h.finish()
}

/// Returns `v` if its hash differs from `last`, and stores the new hash.
fn changed<T: Serialize>(last: &mut Option<u64>, v: Option<T>) -> Option<T> {
    let v = v?;
    let h = hash_of(&v);
    if *last == Some(h) {
        return None;
    }
    *last = Some(h);
    Some(v)
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut rx = app.state::<AppState>().poller.focus.subscribe();
        let mut last_focus: Option<Focus> = None;
        let mut last_full: Option<Instant> = None;
        loop {
            let current = rx.borrow_and_update().clone();
            let Some(focus) = current else {
                if rx.changed().await.is_err() {
                    return;
                }
                continue;
            };
            let state = app.state::<AppState>();
            let focus_changed = last_focus.as_ref() != Some(&focus);
            if focus_changed {
                *state.poller.hashes.lock().unwrap() = Hashes::default();
                last_full = None;
                last_focus = Some(focus.clone());
            }
            let (focused_secs, background_secs) = {
                let s = state.settings.read().await;
                (s.poll_focused_secs.max(1), s.poll_background_secs.max(1))
            };
            let forced = state.poller.force_full.swap(false, Ordering::SeqCst);
            let full = forced
                || focus.service.is_none()
                || last_full.is_none_or(|t| t.elapsed() >= Duration::from_secs(background_secs));
            if full {
                last_full = Some(Instant::now());
            }

            let (update, error) = poll_once(&state, &focus, full).await;

            // Drop results for a focus the user already left.
            if !rx.has_changed().unwrap_or(false) {
                let update = {
                    let mut h = state.poller.hashes.lock().unwrap();
                    EcsUpdate {
                        clusters: changed(&mut h.clusters, update.clusters),
                        services: changed(&mut h.services, update.services),
                        service_detail: changed(&mut h.service_detail, update.service_detail),
                        tasks: changed(&mut h.tasks, update.tasks),
                        ..update
                    }
                };
                let any = update.clusters.is_some()
                    || update.services.is_some()
                    || update.service_detail.is_some()
                    || update.tasks.is_some();
                if any || focus_changed {
                    if let Err(e) = app.emit(events::ECS_UPDATE, &update) {
                        log::warn!("emit {} failed: {e}", events::ECS_UPDATE);
                    }
                }
                let status = PollStatus {
                    polled_at: Some(update.polled_at),
                    api_calls_per_min: state.limiter.calls_per_min(&focus.profile, &focus.region).await,
                    budget_pct: state.limiter.budget_pct(&focus.profile, &focus.region).await,
                    throttled: state.limiter.is_slowed(&focus.profile, &focus.region).await,
                    last_error: error,
                };
                *state.poller.status.lock().unwrap() = status.clone();
                if let Err(e) = app.emit(events::POLL_STATUS, &status) {
                    log::warn!("emit {} failed: {e}", events::POLL_STATUS);
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(focused_secs)) => {}
                _ = state.poller.wake.notified() => {}
                r = rx.changed() => if r.is_err() { return },
            }
        }
    });
}

