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

/// Returns one Pending entry per profile and region at once, then scans in the background.
/// `profiles` = None scans every profile.
#[tauri::command]
pub async fn fleet_scan(app: AppHandle, state: State<'_, AppState>, profiles: Option<Vec<String>>) -> AppResult<Vec<FleetEntry>> {
    let raw = read_raw_profiles().await;
    let mut targets = {
        let settings = state.settings.read().await;
        build_entries(&raw, &settings, profiles.as_deref())
    };

    let fleet = &state.fleet;
    let generation = fleet.generation.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(old) = fleet.task.lock().map_err(|_| AppError::internal("fleet lock"))?.take() {
        old.abort();
    }
    {
        let mut entries = fleet.entries.lock().map_err(|_| AppError::internal("fleet lock"))?;
        // The old scan stops here, so its unfinished pairs join this scan.
        for e in entries.iter() {
            let unfinished = matches!(e.status, FleetStatus::Pending | FleetStatus::Scanning);
            if unfinished && !targets.iter().any(|t| same_pair(t, e)) {
                targets.push(pending(&e.profile, &e.region, e.is_prod));
            }
        }
        if profiles.is_none() {
            entries.clear();
        }
        for t in &targets {
            upsert(&mut entries, t.clone());
        }
    }

    let handle = {
        let targets = targets.clone();
        tauri::async_runtime::spawn(async move {
            let sem = Arc::new(Semaphore::new(MAX_PARALLEL));
            join_all(targets.into_iter().map(|e| {
                let (app, sem) = (app.clone(), sem.clone());
                async move { scan_pair(&app, generation, &sem, e).await }
            }))
            .await;
        })
    };
    if let Ok(mut slot) = fleet.task.lock() {
        *slot = Some(handle);
    }
    Ok(targets)
}

/// The latest result for each profile and region.
#[tauri::command]
pub async fn fleet_snapshot(state: State<'_, AppState>) -> AppResult<Vec<FleetEntry>> {
    Ok(state.fleet.snapshot())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profiles::parse_profiles;

    fn svc(name: &str, cluster: &str, health: ServiceHealth, running: i32, desired: i32) -> ServiceSummary {
        ServiceSummary {
            arn: format!("arn:{cluster}/{name}"),
            name: name.into(),
            cluster_name: cluster.into(),
            status: "ACTIVE".into(),
            desired,
            running,
            pending: 0,
            task_definition: String::new(),
            task_definition_short: String::new(),
            launch_type: None,
            health,
            deployments: vec![],
            created_at: None,
            enable_execute_command: false,
            load_balancers: vec![],
        }
    }

    const CONFIG: &str = "[profile b-prod]\nregion = eu-west-1\n[profile a-dev]\nregion = us-east-1\n";

    #[test]
    fn builds_one_pending_entry_per_region() {
        let raw = parse_profiles(CONFIG, "");
        let mut s = Settings::default();
        s.profile_regions.insert("a-dev".into(), vec!["us-east-1".into(), "us-west-2".into()]);
        let all = build_entries(&raw, &s, None);
        let pairs: Vec<_> = all.iter().map(|e| (e.profile.as_str(), e.region.as_str(), e.is_prod)).collect();
        assert_eq!(pairs, [("a-dev", "us-east-1", false), ("a-dev", "us-west-2", false), ("b-prod", "eu-west-1", true)]);
        assert!(all.iter().all(|e| e.status == FleetStatus::Pending && e.scanned_at.is_none()));

        let only = build_entries(&raw, &s, Some(&["b-prod".to_owned()]));
        assert_eq!(only.len(), 1);
        assert_eq!(only[0].profile, "b-prod");
    }

    #[test]
    fn sorts_attention_failing_degraded_deploying() {
        let list = [
            svc("a", "c1", ServiceHealth::Deploying, 1, 2),
            svc("b", "c1", ServiceHealth::Healthy, 2, 2),
            svc("c", "c2", ServiceHealth::Failing, 0, 2),
            svc("d", "c1", ServiceHealth::Degraded, 1, 2),
            svc("e", "c1", ServiceHealth::Failing, 0, 1),
        ];
        let names: Vec<_> = attention(&list).into_iter().map(|s| s.name).collect();
        assert_eq!(names, ["e", "c", "d", "a"]);
    }

    #[test]
    fn fills_totals_and_counts() {
        let list = [svc("a", "c1", ServiceHealth::Healthy, 2, 2), svc("b", "c1", ServiceHealth::Failing, 1, 3)];
        let e = finish_ok(pending("p", "r", false), 1, &list, 42);
        assert_eq!(e.status, FleetStatus::Ok);
        assert_eq!((e.clusters, e.services, e.running_tasks, e.desired_tasks), (1, 2, 3, 5));
        assert_eq!(e.attention.len(), 1);
        assert_eq!(e.scanned_at, Some(42));
    }

    #[test]
    fn maps_errors_to_status() {
        let auth = finish_err(pending("p", "r", false), &AppError::new(ErrorKind::Auth, "x"), 1);
        assert_eq!(auth.status, FleetStatus::Auth);
        assert_eq!(auth.message.as_deref(), Some(AUTH_MESSAGE));
        let other = finish_err(pending("p", "r", false), &AppError::new(ErrorKind::Aws, "boom"), 1);
        assert_eq!(other.status, FleetStatus::Error);
        assert_eq!(other.message.as_deref(), Some("boom"));
    }

    #[test]
    fn upsert_replaces_by_pair() {
        let mut v = vec![pending("b", "r1", false)];
        upsert(&mut v, pending("a", "r1", false));
        upsert(&mut v, FleetEntry { status: FleetStatus::Ok, ..pending("b", "r1", false) });
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].profile, "a");
        assert_eq!(v[1].status, FleetStatus::Ok);
    }

    #[test]
    fn drops_stale_results() {
        let f = FleetShared::default();
        f.generation.store(2, Ordering::SeqCst);
        assert!(!f.store(1, &pending("p", "r", false)));
        assert!(f.store(2, &pending("p", "r", false)));
        assert_eq!(f.snapshot().len(), 1);
    }
}
