//! CPU and memory from CloudWatch GetMetricData.

use aws_sdk_cloudwatch::types::{Dimension, Metric, MetricDataQuery, MetricStat, ScanBy};
use aws_smithy_types::DateTime;
use tauri::State;

use crate::error::AppResult;
use crate::models::{MetricPoint, ServiceMetrics};
use crate::ops::{fail, short_name};
use crate::state::AppState;

/// Picks the metric period in seconds for a time range in minutes.
pub fn period_for_range(range_minutes: i64) -> i32 {
    if range_minutes <= 3 * 60 {
        60
    } else if range_minutes <= 24 * 60 {
        300
    } else {
        3600
    }
}

fn query(id: &str, metric: &str, cluster: &str, service: &str, period: i32) -> MetricDataQuery {
    let metric = Metric::builder()
        .namespace("AWS/ECS")
        .metric_name(metric)
        .dimensions(Dimension::builder().name("ClusterName").value(cluster).build())
        .dimensions(Dimension::builder().name("ServiceName").value(service).build())
        .build();
    MetricDataQuery::builder()
        .id(id)
        .metric_stat(MetricStat::builder().metric(metric).period(period).stat("Average").build())
        .return_data(true)
        .build()
}

#[tauri::command]
pub async fn get_metrics(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    cluster: String,
    service: String,
    range_minutes: i64,
) -> AppResult<ServiceMetrics> {
    let range_minutes = range_minutes.max(1);
    let period = period_for_range(range_minutes);
    let cluster = short_name(&cluster).to_owned();
    let service = short_name(&service).to_owned();
    let end_ms = chrono::Utc::now().timestamp_millis();
    let start_ms = end_ms - range_minutes * 60_000;

    let ctx = state.clients.get(&profile, &region).await;
    let mut cpu = Vec::new();
    let mut memory = Vec::new();
    let mut next_token: Option<String> = None;
    loop {
        state.limiter.acquire(&profile, &region).await;
        let res = ctx
            .cw
            .get_metric_data()
            .metric_data_queries(query("cpu", "CPUUtilization", &cluster, &service, period))
            .metric_data_queries(query("mem", "MemoryUtilization", &cluster, &service, period))
            .start_time(DateTime::from_millis(start_ms))
            .end_time(DateTime::from_millis(end_ms))
            .scan_by(ScanBy::TimestampAscending)
            .set_next_token(next_token.take())
            .send()
            .await;
        let out = match res {
            Ok(o) => o,
            Err(e) => return Err(fail(&state, &profile, &region, e).await),
        };
        for r in out.metric_data_results() {
            let dest = match r.id() {
                Some("cpu") => &mut cpu,
                Some("mem") => &mut memory,
                _ => continue,
            };
            for (t, v) in r.timestamps().iter().zip(r.values()) {
                if let Ok(t) = t.to_millis() {
                    dest.push(MetricPoint { t, v: *v });
                }
            }
        }
        match out.next_token() {
            Some(t) if !t.is_empty() => next_token = Some(t.to_owned()),
            _ => break,
        }
    }
    cpu.sort_by_key(|p| p.t);
    memory.sort_by_key(|p| p.t);
    Ok(ServiceMetrics { cpu, memory, period_secs: period })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn period_matches_range() {
        assert_eq!(period_for_range(15), 60);
        assert_eq!(period_for_range(180), 60);
        assert_eq!(period_for_range(181), 300);
        assert_eq!(period_for_range(1440), 300);
        assert_eq!(period_for_range(1441), 3600);
        assert_eq!(period_for_range(7 * 1440), 3600);
    }
}
