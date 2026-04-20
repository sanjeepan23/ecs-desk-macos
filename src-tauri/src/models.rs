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

