//! Settings persistence in SQLite.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::Settings;
use crate::state::AppState;

const SETTINGS_KEY: &str = "settings";

fn open(db: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(db)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")?;
    Ok(conn)
}

/// Returns defaults when the file or the row does not exist.
pub fn load_settings(db: &Path) -> anyhow::Result<Settings> {
    if !db.exists() {
        return Ok(Settings::default());
    }
    let conn = open(db)?;
    let value: Option<String> = conn
        .query_row("SELECT value FROM kv WHERE key = ?1", [SETTINGS_KEY], |r| r.get(0))
        .optional()?;
    match value {
        Some(v) => Ok(serde_json::from_str(&v)?),
        None => Ok(Settings::default()),
    }
}

pub fn save_settings(db: &Path, settings: &Settings) -> anyhow::Result<()> {
    let conn = open(db)?;
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (SETTINGS_KEY, serde_json::to_string(settings)?),
    )?;
    Ok(())
}

/// Writes the settings to SQLite on a blocking thread.
pub async fn persist(db: PathBuf, settings: Settings) -> AppResult<()> {
    tokio::task::spawn_blocking(move || save_settings(&db, &settings))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
        .map_err(AppError::from)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> AppResult<Settings> {
    Ok(state.settings.read().await.clone())
}

#[tauri::command]
pub async fn update_settings(state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    let mut guard = state.settings.write().await;
    let settings = keep_safety_fields(&guard, settings);
    persist(state.db_path.clone(), settings.clone()).await?;
    *guard = settings.clone();
    Ok(settings)
}

/// The UI can send a stale copy, so read-only choices and detected production profiles come from `current`.
/// Only `set_read_only` and `note_resource_names` change them.
fn keep_safety_fields(current: &Settings, incoming: Settings) -> Settings {
    Settings { read_only: current.read_only.clone(), detected_prod: current.detected_prod.clone(), ..incoming }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let s = load_settings(&dir.path().join("none.sqlite")).unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn missing_row_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("x.sqlite");
        open(&db).unwrap();
        assert_eq!(load_settings(&db).unwrap(), Settings::default());
    }

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("x.sqlite");
        let mut s = Settings { poll_focused_secs: 5, theme: "dark".into(), ..Settings::default() };
        s.read_only.insert("demo-prod".into(), false);
        s.profile_regions.insert("dev".into(), vec!["eu-west-1".into()]);
        save_settings(&db, &s).unwrap();
        assert_eq!(load_settings(&db).unwrap(), s);
        s.telemetry = true;
        save_settings(&db, &s).unwrap();
        assert_eq!(load_settings(&db).unwrap(), s);
    }

    #[test]
    fn stale_ui_settings_keep_safety_fields() {
        let mut current = Settings::default();
        current.detected_prod.insert("demo".into());
        current.read_only.insert("dev".into(), true);
        let incoming = Settings { last_region: Some("eu-west-1".into()), ..Settings::default() };
        let merged = keep_safety_fields(&current, incoming);
        assert_eq!(merged.last_region.as_deref(), Some("eu-west-1"));
        assert!(merged.is_read_only("demo"));
        assert!(merged.is_read_only("dev"));
    }
}
