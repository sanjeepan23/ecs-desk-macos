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

fn same_pair(a: &FleetEntry, b: &FleetEntry) -> bool {
    a.profile == b.profile && a.region == b.region
}

/// Replaces the entry with the same profile and region, or adds it in sorted order.
fn upsert(entries: &mut Vec<FleetEntry>, entry: FleetEntry) {
    match entries.iter_mut().find(|e| same_pair(e, &entry)) {
        Some(slot) => *slot = entry,
        None => {
            let at = entries.iter().position(|e| e.profile > entry.profile).unwrap_or(entries.len());
            entries.insert(at, entry);
        }
    }
}

fn pending(profile: &str, region: &str, is_prod: bool) -> FleetEntry {
    FleetEntry {
        profile: profile.to_owned(),
        region: region.to_owned(),
        status: FleetStatus::Pending,
        message: None,
        is_prod,
        clusters: 0,
        services: 0,
        running_tasks: 0,
        desired_tasks: 0,
        attention: vec![],
        scanned_at: None,
    }
}

/// One Pending entry per profile and region, in profile name order.
/// `only` = None selects every profile.
fn build_entries(raw: &[RawProfile], settings: &Settings, only: Option<&[String]>) -> Vec<FleetEntry> {
    raw.iter()
        .filter(|p| only.is_none_or(|names| names.contains(&p.name)))
        .flat_map(|p| {
            let profile = to_profile(p, settings);
            profile.regions.iter().map(|r| pending(&profile.name, r, profile.is_prod)).collect::<Vec<_>>()
        })
        .collect()
}

fn attention_rank(h: ServiceHealth) -> u8 {
    match h {
        ServiceHealth::Failing => 0,
        ServiceHealth::Degraded => 1,
        ServiceHealth::Deploying => 2,
        ServiceHealth::Healthy => 3,
    }
}

/// Services that are not healthy: failing, then degraded, then deploying. Names sort each group.
fn attention(services: &[ServiceSummary]) -> Vec<ServiceSummary> {
    let mut out: Vec<_> = services.iter().filter(|s| s.health != ServiceHealth::Healthy).cloned().collect();
    out.sort_by(|a, b| {
        attention_rank(a.health)
            .cmp(&attention_rank(b.health))
            .then_with(|| a.cluster_name.cmp(&b.cluster_name))
            .then_with(|| a.name.cmp(&b.name))
    });
    out
}

/// Fills counts, task totals, and attention from a finished scan.
fn finish_ok(mut e: FleetEntry, clusters: usize, services: &[ServiceSummary], at: i64) -> FleetEntry {
    e.status = FleetStatus::Ok;
    e.message = None;
    e.clusters = clusters as u32;
    e.services = services.len() as u32;
    e.running_tasks = services.iter().map(|s| s.running).sum();
    e.desired_tasks = services.iter().map(|s| s.desired).sum();
    e.attention = attention(services);
    e.scanned_at = Some(at);
    e
}

fn finish_err(mut e: FleetEntry, err: &AppError, at: i64) -> FleetEntry {
    let auth = err.kind == ErrorKind::Auth;
    e.status = if auth { FleetStatus::Auth } else { FleetStatus::Error };
    e.message = Some(if auth { AUTH_MESSAGE.to_owned() } else { err.message.clone() });
    e.attention.clear();
    e.scanned_at = Some(at);
    e
}

/// Reads clusters and the services of every cluster. Both calls go through the rate limiter.
async fn read_pair(st: &AppState, profile: &str, region: &str) -> AppResult<(usize, Vec<ServiceSummary>)> {
    let clusters = crate::ecs::fetch_clusters(st, profile, region).await?;
    let lists =
        try_join_all(clusters.iter().map(|c| crate::ecs::fetch_services(st, profile, region, &c.name))).await?;
    Ok((clusters.len(), lists.into_iter().flatten().collect()))
}

async fn scan_pair(app: &AppHandle, generation: u64, sem: &Semaphore, entry: FleetEntry) {
    let Ok(_permit) = sem.acquire().await else { return };
    let st = app.state::<AppState>();
    let scanning = FleetEntry { status: FleetStatus::Scanning, ..entry.clone() };
    if !st.fleet.store(generation, &scanning) {
        return;
    }
    let _ = app.emit(events::FLEET_ENTRY, &scanning);

    let result = read_pair(&st, &entry.profile, &entry.region).await;
    let mut done = match result {
        Ok((clusters, services)) => finish_ok(entry, clusters, &services, now_ms()),
        Err(e) => finish_err(entry, &e, now_ms()),
    };
    // The scan can detect a production profile, so read the flag again.
    done.is_prod = st.settings.read().await.is_prod(&done.profile);
    if st.fleet.store(generation, &done) {
        let _ = app.emit(events::FLEET_ENTRY, &done);
    }
}

