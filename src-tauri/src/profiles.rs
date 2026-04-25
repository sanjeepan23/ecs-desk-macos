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

/// Merges profiles from the config and credentials file contents. The result is sorted by name.
pub fn parse_profiles(config: &str, credentials: &str) -> Vec<RawProfile> {
    let mut map: BTreeMap<String, RawProfile> = BTreeMap::new();
    for (header, kv) in parse_ini(config) {
        let name = if header == "default" {
            header
        } else if let Some(n) = header.strip_prefix("profile ") {
            n.trim().to_owned()
        } else {
            // "sso-session x", "services x", and other sections are not profiles.
            continue;
        };
        let p = map.entry(name.clone()).or_insert_with(|| RawProfile { name, ..Default::default() });
        p.config.extend(kv);
    }
    for (name, kv) in parse_ini(credentials) {
        let p = map.entry(name.clone()).or_insert_with(|| RawProfile { name, ..Default::default() });
        if kv.contains_key("aws_access_key_id") {
            p.has_static_keys = true;
        }
    }
    map.into_values().collect()
}

pub fn auth_kind(p: &RawProfile) -> AuthKind {
    let has = |k: &str| p.config.contains_key(k);
    if has("sso_session") || has("sso_start_url") {
        AuthKind::Sso
    } else if has("role_arn") {
        AuthKind::AssumeRole
    } else if has("credential_process") {
        AuthKind::Process
    } else if p.has_static_keys || has("aws_access_key_id") {
        AuthKind::Static
    } else {
        AuthKind::Unknown
    }
}

pub fn account_id(p: &RawProfile) -> Option<String> {
    if let Some(a) = p.config.get("sso_account_id") {
        return Some(a.clone());
    }
    // arn:aws:iam::<account>:role/<name>
    let arn = p.config.get("role_arn")?;
    arn.split(':').nth(4).filter(|a| !a.is_empty()).map(str::to_owned)
}

pub fn to_profile(p: &RawProfile, settings: &Settings) -> Profile {
    let region = p.config.get("region").cloned();
    let regions = settings
        .profile_regions
        .get(&p.name)
        .filter(|r| !r.is_empty())
        .cloned()
        .or_else(|| region.clone().map(|r| vec![r]))
        .unwrap_or_else(|| vec!["us-east-1".to_owned()]);
    Profile {
        name: p.name.clone(),
        account_id: account_id(p),
        region,
        regions,
        auth_kind: auth_kind(p),
        is_prod: settings.is_prod(&p.name),
        read_only: settings.is_read_only(&p.name),
    }
}

fn aws_file(env: &str, default: &str) -> Option<PathBuf> {
    match std::env::var_os(env) {
        Some(v) if !v.is_empty() => {
            let s = PathBuf::from(&v);
            match s.strip_prefix("~") {
                Ok(rest) => dirs::home_dir().map(|h| h.join(rest)),
                Err(_) => Some(s),
            }
        }
        _ => dirs::home_dir().map(|h| h.join(".aws").join(default)),
    }
}

/// Reads both files from disk. A missing file counts as empty.
pub async fn read_raw_profiles() -> Vec<RawProfile> {
    async fn read(p: Option<PathBuf>) -> String {
        match p {
            Some(p) => tokio::fs::read_to_string(p).await.unwrap_or_default(),
            None => String::new(),
        }
    }
    let config = read(aws_file("AWS_CONFIG_FILE", "config")).await;
    let creds = read(aws_file("AWS_SHARED_CREDENTIALS_FILE", "credentials")).await;
    parse_profiles(&config, &creds)
}

