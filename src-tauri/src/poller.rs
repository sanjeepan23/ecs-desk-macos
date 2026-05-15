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

