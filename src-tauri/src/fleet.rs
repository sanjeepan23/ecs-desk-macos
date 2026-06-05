//! Scans every profile and region for services that need attention. Emits `fleet://entry`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use futures::future::{join_all, try_join_all};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Semaphore;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::models::{events, FleetEntry, FleetStatus, ServiceHealth, ServiceSummary, Settings};
use crate::profiles::{read_raw_profiles, to_profile, RawProfile};
use crate::state::AppState;

/// Profile and region pairs that scan at the same time.
const MAX_PARALLEL: usize = 4;
const AUTH_MESSAGE: &str = "Session expired. Log in to scan this profile.";

#[derive(Default)]
pub struct FleetShared {
    entries: Mutex<Vec<FleetEntry>>,
    /// Each scan gets a new number. Results of an older scan are dropped.
    generation: AtomicU64,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl FleetShared {
    fn snapshot(&self) -> Vec<FleetEntry> {
        self.entries.lock().map(|e| e.clone()).unwrap_or_default()
    }

    /// Stores the entry if it belongs to the current scan. Returns false for a stale entry.
    fn store(&self, generation: u64, entry: &FleetEntry) -> bool {
        let Ok(mut entries) = self.entries.lock() else { return false };
        if self.generation.load(Ordering::SeqCst) != generation {
            return false;
        }
        upsert(&mut entries, entry.clone());
        true
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

