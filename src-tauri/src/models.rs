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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogTarget {
    pub group: String,
    pub stream_prefix: Option<String>,
    pub container: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub timestamp: i64,
    /// "DEBUG" | "INFO" | "WARN" | "ERROR", guessed from the message.
    pub level: String,
    pub message: String,
    pub group: String,
    pub stream: String,
}

/// Payload of the `logs://lines` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBatch {
    pub session_id: String,
    pub lines: Vec<LogLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricPoint {
    pub t: i64,
    pub v: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMetrics {
    pub cpu: Vec<MetricPoint>,
    pub memory: Vec<MetricPoint>,
    pub period_secs: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecCheck {
    pub ok: bool,
    pub problems: Vec<String>,
    pub plugin_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecStart {
    pub session_id: String,
    pub profile: String,
    pub region: String,
    pub cluster: String,
    pub task_arn: String,
    pub container: String,
    pub command: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// Payload of the `exec://output` event. `data` is UTF-8 text from the PTY.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutput {
    pub session_id: String,
    pub data: String,
}

/// Payload of the `exec://exit` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecExit {
    pub session_id: String,
    pub code: Option<i32>,
}

// ---------- Stopped-task analysis ----------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum StopCategory {
    OutOfMemory,
    HealthCheck,
    ImagePull,
    Secrets,
    EssentialExit,
    Capacity,
    Network,
    SpotInterruption,
    Deployment,
    ScaleIn,
    UserStopped,
    Other,
}

/// Stopped tasks of one service that share a cause.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopGroup {
    pub category: StopCategory,
    /// Short label, for example "Out of memory".
    pub title: String,
    pub count: u32,
    pub last_seen: Option<i64>,
    /// Newest first, at most 20.
    pub task_arns: Vec<String>,
    pub exit_codes: Vec<i32>,
    pub containers: Vec<String>,
    pub sample_reason: String,
    /// One or two sentences that say what to check or change.
    pub advice: String,
    /// True for normal stops, such as a deployment or scale-in.
    pub expected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoppedAnalysis {
    pub total: u32,
    /// Problem groups first, then expected groups; each by count, descending.
    pub groups: Vec<StopGroup>,
    /// True when unexpected stops repeat fast enough to look like a crash loop.
    pub crash_loop: bool,
    pub analyzed_at: i64,
}

// ---------- Deployment watch ----------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WatchPhase {
    InProgress,
    Completed,
    Failed,
    RolledBack,
    TimedOut,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployWatch {
    /// "<profile>/<region>/<cluster>/<service>"
    pub id: String,
    pub target: ServiceRef,
    pub deployment_id: Option<String>,
    pub task_definition: String,
    pub phase: WatchPhase,
    pub desired: i32,
    pub running: i32,
    pub pending: i32,
    pub failed: i32,
    pub started_at: i64,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
    /// Service events since the watch started, newest first.
    pub events: Vec<ServiceEvent>,
    /// Tasks of the watched deployment that stopped, newest first, at most 10.
    pub failed_tasks: Vec<Task>,
    pub message: Option<String>,
}

// ---------- Fleet (all accounts) ----------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FleetStatus {
    Pending,
    Scanning,
    Ok,
    Auth,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FleetEntry {
    pub profile: String,
    pub region: String,
    pub status: FleetStatus,
    pub message: Option<String>,
    pub is_prod: bool,
    pub clusters: u32,
    pub services: u32,
    pub running_tasks: i32,
    pub desired_tasks: i32,
    /// Services that are not healthy.
    pub attention: Vec<ServiceSummary>,
    pub scanned_at: Option<i64>,
}

pub mod events {
    pub const ECS_UPDATE: &str = "ecs://update";
    pub const POLL_STATUS: &str = "ecs://poll-status";
    pub const LOG_LINES: &str = "logs://lines";
    pub const EXEC_OUTPUT: &str = "exec://output";
    pub const EXEC_EXIT: &str = "exec://exit";
    /// Sent with no payload when the profile list changes, for example after prod detection.
    pub const PROFILES_CHANGED: &str = "profiles://changed";
    pub const DEPLOY_WATCH: &str = "deploy://watch";
    pub const FLEET_ENTRY: &str = "fleet://entry";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prod_profiles_start_read_only() {
        let s = Settings::default();
        assert!(s.is_read_only("demo-prod"));
        assert!(s.is_read_only("PROD"));
        assert!(!s.is_read_only("demo-staging"));
    }

    #[test]
    fn detected_prod_profiles_start_read_only() {
        let mut s = Settings::default();
        assert!(!s.is_read_only("bitwize"));
        s.detected_prod.insert("bitwize".into());
        assert!(s.is_prod("bitwize"));
        assert!(s.is_read_only("bitwize"));
        s.read_only.insert("bitwize".into(), false);
        assert!(!s.is_read_only("bitwize"));
    }

    #[test]
    fn explicit_choice_overrides_default() {
        let mut s = Settings::default();
        s.read_only.insert("demo-prod".into(), false);
        s.read_only.insert("dev".into(), true);
        assert!(!s.is_read_only("demo-prod"));
        assert!(s.is_read_only("dev"));
    }
}
