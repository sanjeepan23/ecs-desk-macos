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

