//! Converts AWS SDK types to the models in `models.rs`.
//! The ops-backend agent calls these two functions; keep their names and signatures.

use aws_sdk_ecs::types as sdk;
use aws_smithy_types::DateTime;

use crate::models::{Container, Deployment, ServiceEvent, ServiceSummary, Task};

pub fn service_summary(s: &sdk::Service) -> ServiceSummary {
    let deployments: Vec<Deployment> = s.deployments().iter().map(deployment).collect();
    let task_definition = s.task_definition().unwrap_or_default().to_owned();
    let primary_rollout = deployments
        .iter()
        .find(|d| d.status == "PRIMARY")
        .and_then(|d| d.rollout_state.clone());
    let events: Vec<ServiceEvent> = s.events().iter().map(service_event).collect();
    let health = crate::ecs::service_health(&crate::ecs::HealthInput {
        primary_rollout: primary_rollout.as_deref(),
        deployment_count: deployments.len(),
        desired: s.desired_count(),
        running: s.running_count(),
        events: &events,
        now_ms: chrono::Utc::now().timestamp_millis(),
    });
    ServiceSummary {
        arn: s.service_arn().unwrap_or_default().to_owned(),
        name: s.service_name().unwrap_or_default().to_owned(),
        cluster_name: arn_name(s.cluster_arn().unwrap_or_default()),
        status: s.status().unwrap_or_default().to_owned(),
        desired: s.desired_count(),
        running: s.running_count(),
        pending: s.pending_count(),
        task_definition_short: task_def_short(&task_definition),
        task_definition,
        launch_type: s
            .launch_type()
            .map(|l| l.as_str().to_owned())
            .or_else(|| s.capacity_provider_strategy().first().map(|c| c.capacity_provider().to_owned())),
        health,
        deployments,
        created_at: ms(s.created_at()),
        enable_execute_command: s.enable_execute_command(),
        load_balancers: s
            .load_balancers()
            .iter()
            .filter_map(|lb| {
                lb.target_group_arn()
                    .map(arn_name)
                    .or_else(|| lb.load_balancer_name().map(str::to_owned))
            })
            .collect(),
    }
}

pub fn task_model(t: &sdk::Task) -> Task {
    let arn = t.task_arn().unwrap_or_default().to_owned();
    let task_definition = t.task_definition_arn().unwrap_or_default().to_owned();
    let private_ip = t
        .containers()
        .iter()
        .flat_map(|c| c.network_interfaces())
        .find_map(|n| n.private_ipv4_address())
        .or_else(|| {
            t.attachments()
                .iter()
                .flat_map(|a| a.details())
                .find(|kv| kv.name() == Some("privateIPv4Address"))
                .and_then(|kv| kv.value())
        })
        .map(str::to_owned);
    Task {
        id: arn_name(&arn),
        arn,
        cluster_name: arn_name(t.cluster_arn().unwrap_or_default()),
        service_name: t.group().and_then(|g| g.strip_prefix("service:")).map(str::to_owned),
        last_status: t.last_status().unwrap_or_default().to_owned(),
        desired_status: t.desired_status().unwrap_or_default().to_owned(),
        health_status: t.health_status().map(|h| h.as_str().to_owned()),
        revision: revision(&task_definition),
        task_definition,
        availability_zone: t.availability_zone().map(str::to_owned),
        private_ip,
        cpu: t.cpu().map(str::to_owned),
        memory: t.memory().map(str::to_owned),
        started_at: ms(t.started_at()),
        stopped_at: ms(t.stopped_at()),
        stop_reason: t.stopped_reason().map(str::to_owned),
        stop_code: t.stop_code().map(|c| c.as_str().to_owned()),
        launch_type: t
            .launch_type()
            .map(|l| l.as_str().to_owned())
            .or_else(|| t.capacity_provider_name().map(str::to_owned)),
        enable_execute_command: t.enable_execute_command(),
        containers: t.containers().iter().map(container).collect(),
    }
}

pub fn service_event(e: &sdk::ServiceEvent) -> ServiceEvent {
    ServiceEvent {
        id: e.id().unwrap_or_default().to_owned(),
        created_at: ms(e.created_at()),
        message: e.message().unwrap_or_default().to_owned(),
    }
}

fn deployment(d: &sdk::Deployment) -> Deployment {
    Deployment {
        id: d.id().unwrap_or_default().to_owned(),
        status: d.status().unwrap_or_default().to_owned(),
        task_definition: d.task_definition().unwrap_or_default().to_owned(),
        desired: d.desired_count(),
        running: d.running_count(),
        pending: d.pending_count(),
        failed: d.failed_tasks(),
        rollout_state: d.rollout_state().map(|r| r.as_str().to_owned()),
        rollout_reason: d.rollout_state_reason().map(str::to_owned),
        created_at: ms(d.created_at()),
        updated_at: ms(d.updated_at()),
    }
}

fn container(c: &sdk::Container) -> Container {
    Container {
        name: c.name().unwrap_or_default().to_owned(),
        image: c.image().map(str::to_owned),
        last_status: c.last_status().map(str::to_owned),
        health_status: c.health_status().map(|h| h.as_str().to_owned()),
        exit_code: c.exit_code(),
        reason: c.reason().map(str::to_owned),
        runtime_id: c.runtime_id().map(str::to_owned),
        exec_agent_status: c
            .managed_agents()
            .iter()
            .find(|a| matches!(a.name(), Some(sdk::ManagedAgentName::ExecuteCommandAgent)))
            .and_then(|a| a.last_status())
            .map(str::to_owned),
    }
}

/// Unix time in milliseconds.
pub fn ms(t: Option<&DateTime>) -> Option<i64> {
    t.and_then(|t| t.to_millis().ok())
}

/// The last "/" segment of an ARN, or the input if it has no "/".
pub fn arn_name(arn: &str) -> String {
    arn.rsplit('/').next().unwrap_or(arn).to_owned()
}

/// "arn:...:task-definition/web:42" becomes "web:42".
pub fn task_def_short(arn: &str) -> String {
    arn_name(arn)
}

