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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ServiceHealth {
    Healthy,
    Deploying,
    Degraded,
    Failing,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub id: String,
    /// "PRIMARY" | "ACTIVE" | "INACTIVE"
    pub status: String,
    pub task_definition: String,
    pub desired: i32,
    pub running: i32,
    pub pending: i32,
    pub failed: i32,
    /// "IN_PROGRESS" | "COMPLETED" | "FAILED"
    pub rollout_state: Option<String>,
    pub rollout_reason: Option<String>,
    /// Unix time in milliseconds.
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSummary {
    pub arn: String,
    pub name: String,
    pub cluster_name: String,
    pub status: String,
    pub desired: i32,
    pub running: i32,
    pub pending: i32,
    /// Full task definition ARN.
    pub task_definition: String,
    /// "family:revision"
    pub task_definition_short: String,
    pub launch_type: Option<String>,
    pub health: ServiceHealth,
    pub deployments: Vec<Deployment>,
    pub created_at: Option<i64>,
    pub enable_execute_command: bool,
    pub load_balancers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEvent {
    pub id: String,
    pub created_at: Option<i64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceDetail {
    pub service: ServiceSummary,
    pub events: Vec<ServiceEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub name: String,
    pub image: Option<String>,
    pub last_status: Option<String>,
    pub health_status: Option<String>,
    pub exit_code: Option<i32>,
    pub reason: Option<String>,
    pub runtime_id: Option<String>,
    /// "RUNNING" | "STOPPED" | ... for the ECS Exec agent, if present.
    pub exec_agent_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub arn: String,
    pub id: String,
    pub cluster_name: String,
    /// From the task group "service:<name>", if any.
    pub service_name: Option<String>,
    pub last_status: String,
    pub desired_status: String,
    pub health_status: Option<String>,
    pub task_definition: String,
    pub revision: Option<i32>,
    pub availability_zone: Option<String>,
    pub private_ip: Option<String>,
    pub cpu: Option<String>,
    pub memory: Option<String>,
    pub started_at: Option<i64>,
    pub stopped_at: Option<i64>,
    pub stop_reason: Option<String>,
    pub stop_code: Option<String>,
    pub launch_type: Option<String>,
    pub enable_execute_command: bool,
    pub containers: Vec<Container>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub struct Focus {
    pub profile: String,
    pub region: String,
    pub cluster: Option<String>,
    pub service: Option<String>,
}

/// Payload of the `ecs://update` event. Fields are `None` when this poll did not fetch them.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EcsUpdate {
    pub profile: String,
    pub region: String,
    pub polled_at: i64,
    pub clusters: Option<Vec<ClusterSummary>>,
    /// Every service in every cluster of this profile and region.
    pub services: Option<Vec<ServiceSummary>>,
    pub service_detail: Option<ServiceDetail>,
    /// Tasks of the focused service.
    pub tasks: Option<Vec<Task>>,
}

/// Payload of the `ecs://poll-status` event and the `poll_status` command.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollStatus {
    pub polled_at: Option<i64>,
    pub api_calls_per_min: u32,
    pub budget_pct: u32,
    pub throttled: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceRef {
    pub profile: String,
    pub region: String,
    pub cluster: String,
    pub service: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRef {
    pub profile: String,
    pub region: String,
    pub cluster: String,
    pub task_arn: String,
}

