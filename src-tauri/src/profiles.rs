//! AWS profiles from ~/.aws/config and ~/.aws/credentials.

use std::collections::BTreeMap;
use std::path::PathBuf;

use tauri::State;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::models::{AuthKind, CallerIdentity, Profile, Settings};
use crate::state::AppState;

type Section = BTreeMap<String, String>;

/// Parses an AWS INI file into sections of key/value pairs, keyed by the raw section header.
/// Indented lines are nested sub-settings (for example `s3 =`), and the parser skips them.
pub fn parse_ini(text: &str) -> BTreeMap<String, Section> {
    let mut out: BTreeMap<String, Section> = BTreeMap::new();
    let mut current: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].split_whitespace().collect::<Vec<_>>().join(" ");
            out.entry(name.clone()).or_default();
            current = Some(name);
            continue;
        }
        if raw.starts_with([' ', '\t']) {
            continue;
        }
        let (Some(section), Some((k, v))) = (&current, line.split_once('=')) else {
            continue;
        };
        out.entry(section.clone()).or_default().insert(k.trim().to_owned(), v.trim().to_owned());
    }
    out
}

/// A profile as found in the files, before settings are applied.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RawProfile {
    pub name: String,
    pub config: Section,
    pub has_static_keys: bool,
}

