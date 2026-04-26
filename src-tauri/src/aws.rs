//! AWS client cache and the per-account, per-region rate limiter.
//! Every AWS call goes through `Limiter::acquire` first.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use aws_config::{BehaviorVersion, Region};
use tokio::sync::Mutex;

pub struct AwsCtx {
    pub ecs: aws_sdk_ecs::Client,
    pub logs: aws_sdk_cloudwatchlogs::Client,
    pub cw: aws_sdk_cloudwatch::Client,
    pub sts: aws_sdk_sts::Client,
}

#[derive(Default)]
pub struct Clients {
    inner: Mutex<HashMap<(String, String), Arc<AwsCtx>>>,
}

impl Clients {
    pub async fn get(&self, profile: &str, region: &str) -> Arc<AwsCtx> {
        let key = (profile.to_owned(), region.to_owned());
        if let Some(c) = self.inner.lock().await.get(&key) {
            return c.clone();
        }
        let config = aws_config::defaults(BehaviorVersion::latest())
            .profile_name(profile)
            .region(Region::new(region.to_owned()))
            .load()
            .await;
        let ctx = Arc::new(AwsCtx {
            ecs: aws_sdk_ecs::Client::new(&config),
            logs: aws_sdk_cloudwatchlogs::Client::new(&config),
            cw: aws_sdk_cloudwatch::Client::new(&config),
            sts: aws_sdk_sts::Client::new(&config),
        });
        self.inner.lock().await.insert(key, ctx.clone());
        ctx
    }

    /// Drops cached clients for a profile, for example after an SSO login.
    pub async fn invalidate(&self, profile: &str) {
        self.inner.lock().await.retain(|(p, _), _| p != profile);
    }
}

