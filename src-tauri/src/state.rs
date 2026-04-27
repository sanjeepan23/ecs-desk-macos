use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::RwLock;

use crate::aws::{Clients, Limiter};
use crate::error::{AppError, AppResult};
use crate::models::{events, is_prod_name, Settings};
use crate::{cache, deploywatch, exec, fleet, logs, poller};

pub struct AppState {
    /// `None` only in tests that run without a Tauri app.
    pub app: Option<AppHandle>,
    pub clients: Clients,
    pub limiter: Limiter,
    pub settings: RwLock<Settings>,
    /// SQLite file for settings and the resource cache.
    pub db_path: PathBuf,
    pub poller: poller::PollerShared,
    pub tails: logs::TailRegistry,
    pub exec: exec::ExecRegistry,
    pub watches: deploywatch::WatchRegistry,
    pub fleet: fleet::FleetShared,
}

impl AppState {
    pub fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        let db_path = dir.join("ecs-desk.sqlite");
        let settings = cache::load_settings(&db_path).unwrap_or_default();
        Ok(Self {
            app: Some(app.clone()),
            clients: Clients::default(),
            limiter: Limiter::default(),
            settings: RwLock::new(settings),
            db_path,
            poller: poller::PollerShared::default(),
            tails: logs::TailRegistry::default(),
            exec: exec::ExecRegistry::default(),
            watches: deploywatch::WatchRegistry::default(),
            fleet: fleet::FleetShared::default(),
        })
    }

    /// Marks a profile as production when any of the names has "prod" in it.
    /// The flag is saved, and the UI gets `profiles://changed` once.
    pub async fn note_resource_names<'a>(&self, profile: &str, names: impl IntoIterator<Item = &'a str>) {
        if !names.into_iter().any(is_prod_name) {
            return;
        }
        let snapshot = {
            let mut s = self.settings.write().await;
            if !s.detected_prod.insert(profile.to_owned()) {
                return;
            }
            s.clone()
        };
        log::warn!("profile {profile} reaches production resources; it now starts in read-only mode");
        if let Err(e) = cache::persist(self.db_path.clone(), snapshot).await {
            log::warn!("could not save production flag for {profile}: {e}");
        }
        if let Some(app) = &self.app {
            let _ = app.emit(events::PROFILES_CHANGED, ());
        }
    }

    /// Every write action calls this first.
    pub async fn guard_write(&self, profile: &str) -> AppResult<()> {
        if self.settings.read().await.is_read_only(profile) {
            return Err(AppError::read_only(profile));
        }
        Ok(())
    }
}
