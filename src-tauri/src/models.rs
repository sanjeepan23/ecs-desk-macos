//! Shared data types sent between the Rust backend and the React UI.
//! Keep in step with `src/lib/types.ts`.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthKind {
    Sso,
    Static,
    AssumeRole,
    Process,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub account_id: Option<String>,
    /// Default region from `~/.aws/config`.
    pub region: Option<String>,
    /// Regions the user chose to show for this profile.
    pub regions: Vec<String>,
    pub auth_kind: AuthKind,
    pub is_prod: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallerIdentity {
    pub account: String,
    pub arn: String,
    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub poll_focused_secs: u64,
    pub poll_background_secs: u64,
    pub confirm_prod_by_typing: bool,
    pub telemetry: bool,
    /// "system" | "light" | "dark"
    pub theme: String,
    pub profile_regions: BTreeMap<String, Vec<String>>,
    /// Explicit read-only choices. A profile with no entry is read-only when it is production.
    pub read_only: BTreeMap<String, bool>,
    pub last_profile: Option<String>,
    pub last_region: Option<String>,
    /// Profiles that reach a cluster or service with "prod" in its name.
    pub detected_prod: BTreeSet<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            poll_focused_secs: 3,
            poll_background_secs: 45,
            confirm_prod_by_typing: true,
            telemetry: false,
            theme: "system".into(),
            profile_regions: BTreeMap::new(),
            read_only: BTreeMap::new(),
            last_profile: None,
            last_region: None,
            detected_prod: BTreeSet::new(),
        }
    }
}

impl Settings {
    pub fn is_read_only(&self, profile: &str) -> bool {
        self.read_only.get(profile).copied().unwrap_or_else(|| self.is_prod(profile))
    }

    /// Production profiles start in read-only mode until the user turns it off.
    pub fn is_prod(&self, profile: &str) -> bool {
        is_prod_name(profile) || self.detected_prod.contains(profile)
    }
}

pub fn is_prod_name(profile: &str) -> bool {
    profile.to_ascii_lowercase().contains("prod")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterSummary {
    pub arn: String,
    pub name: String,
    pub status: String,
    pub active_services: i32,
    pub running_tasks: i32,
    pub pending_tasks: i32,
    pub capacity_providers: Vec<String>,
    pub container_insights: bool,
}

