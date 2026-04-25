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

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> AppResult<Vec<Profile>> {
    let raw = read_raw_profiles().await;
    let settings = state.settings.read().await;
    Ok(raw.iter().map(|p| to_profile(p, &settings)).collect())
}

#[tauri::command]
pub async fn set_read_only(state: State<'_, AppState>, profile: String, value: bool) -> AppResult<Profile> {
    let raw = read_raw_profiles()
        .await
        .into_iter()
        .find(|p| p.name == profile)
        .ok_or_else(|| AppError::new(ErrorKind::NotFound, format!("Profile {profile} not found.")))?;
    let mut settings = state.settings.write().await;
    let mut next = settings.clone();
    next.read_only.insert(profile, value);
    crate::cache::persist(state.db_path.clone(), next.clone()).await?;
    *settings = next;
    Ok(to_profile(&raw, &settings))
}

/// An app opened from the macOS Finder gets a short PATH, so also look in the usual install folders.
const AWS_CLI_DIRS: [&str; 2] = ["/usr/local/bin", "/opt/homebrew/bin"];

fn find_aws_cli() -> PathBuf {
    which::which("aws")
        .ok()
        .or_else(|| AWS_CLI_DIRS.iter().map(|d| PathBuf::from(d).join("aws")).find(|p| p.is_file()))
        .unwrap_or_else(|| PathBuf::from("aws"))
}

#[tauri::command]
pub async fn sso_login(state: State<'_, AppState>, profile: String) -> AppResult<()> {
    let out = tokio::process::Command::new(find_aws_cli())
        .args(["sso", "login", "--profile", &profile])
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| AppError::new(ErrorKind::Auth, format!("Could not run the AWS CLI (aws sso login): {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_owned();
        let msg = if stderr.is_empty() { format!("aws sso login failed with {}", out.status) } else { stderr };
        return Err(AppError::new(ErrorKind::Auth, msg));
    }
    state.clients.invalidate(&profile).await;
    Ok(())
}

#[tauri::command]
pub async fn whoami(state: State<'_, AppState>, profile: String, region: String) -> AppResult<CallerIdentity> {
    let sts = state.clients.get(&profile, &region).await.sts.clone();
    let out = crate::ecs::call(&state, &profile, &region, sts.get_caller_identity().send()).await?;
    Ok(CallerIdentity {
        account: out.account().unwrap_or_default().to_owned(),
        arn: out.arn().unwrap_or_default().to_owned(),
        user_id: out.user_id().unwrap_or_default().to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = r#"
# comment
[default]
region = us-west-2

[profile demo-dev]
sso_session = demo
sso_account_id = 111122223333
sso_role_name = Dev
region = eu-west-1
s3 =
  max_concurrent_requests = 20

; another comment
[profile demo-prod]
role_arn = arn:aws:iam::444455556666:role/Admin
source_profile = default

[profile proc]
credential_process = /usr/bin/get-creds

[profile legacy-sso]
sso_start_url = https://x.awsapps.com/start

[sso-session demo]
sso_start_url = https://my-sso-portal.awsapps.com/start
sso_region = us-east-1

[services local]
"#;

    const CREDS: &str = "[default]\naws_access_key_id = AKIA\naws_secret_access_key = x\n\n[keys-only]\naws_access_key_id=AKIB\n";

    fn find<'a>(v: &'a [RawProfile], n: &str) -> &'a RawProfile {
        v.iter().find(|p| p.name == n).unwrap()
    }

    #[test]
    fn parses_and_merges() {
        let v = parse_profiles(CONFIG, CREDS);
        let names: Vec<_> = v.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["default", "demo-dev", "demo-prod", "keys-only", "legacy-sso", "proc"]);
        assert_eq!(find(&v, "demo-dev").config.get("region").map(String::as_str), Some("eu-west-1"));
        assert!(!find(&v, "demo-dev").config.contains_key("max_concurrent_requests"));
    }

    #[test]
    fn auth_kinds_and_accounts() {
        let v = parse_profiles(CONFIG, CREDS);
        assert_eq!(auth_kind(find(&v, "demo-dev")), AuthKind::Sso);
        assert_eq!(auth_kind(find(&v, "legacy-sso")), AuthKind::Sso);
        assert_eq!(auth_kind(find(&v, "demo-prod")), AuthKind::AssumeRole);
        assert_eq!(auth_kind(find(&v, "proc")), AuthKind::Process);
        assert_eq!(auth_kind(find(&v, "default")), AuthKind::Static);
        assert_eq!(auth_kind(find(&v, "keys-only")), AuthKind::Static);
        assert_eq!(account_id(find(&v, "demo-dev")).as_deref(), Some("111122223333"));
        assert_eq!(account_id(find(&v, "demo-prod")).as_deref(), Some("444455556666"));
        assert_eq!(account_id(find(&v, "proc")), None);
    }

    #[test]
    fn profile_regions_and_flags() {
        let v = parse_profiles(CONFIG, CREDS);
        let mut s = Settings::default();
        let p = to_profile(find(&v, "demo-prod"), &s);
        assert_eq!(p.regions, ["us-east-1"]);
        assert!(p.is_prod && p.read_only);
        assert_eq!(to_profile(find(&v, "demo-dev"), &s).regions, ["eu-west-1"]);

        s.profile_regions.insert("demo-dev".into(), vec!["us-east-2".into(), "ap-south-1".into()]);
        s.read_only.insert("demo-prod".into(), false);
        assert_eq!(to_profile(find(&v, "demo-dev"), &s).regions, ["us-east-2", "ap-south-1"]);
        assert!(!to_profile(find(&v, "demo-prod"), &s).read_only);
    }

    #[test]
    fn parses_file_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = dir.path().join("config");
        std::fs::write(&cfg, "[profile from-file]\nregion = sa-east-1\n").unwrap();
        let text = std::fs::read_to_string(&cfg).unwrap();
        let v = parse_profiles(&text, "");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].name, "from-file");
    }
}
