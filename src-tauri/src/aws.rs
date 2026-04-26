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

/// Token bucket per (profile, region). Capacity is a burst; refill is calls per second.
pub struct Limiter {
    capacity: f64,
    refill_per_sec: f64,
    buckets: Mutex<HashMap<(String, String), Bucket>>,
}

struct Bucket {
    tokens: f64,
    last: Instant,
    /// Rate is halved until this time after a throttling error.
    slow_until: Option<Instant>,
    calls: VecDeque<Instant>,
}

impl Default for Limiter {
    fn default() -> Self {
        Self::new(20.0, 8.0)
    }
}

impl Limiter {
    pub fn new(capacity: f64, refill_per_sec: f64) -> Self {
        Self { capacity, refill_per_sec, buckets: Mutex::new(HashMap::new()) }
    }

    pub async fn acquire(&self, profile: &str, region: &str) {
        loop {
            let wait = {
                let mut map = self.buckets.lock().await;
                let b = map.entry((profile.to_owned(), region.to_owned())).or_insert_with(|| Bucket {
                    tokens: self.capacity,
                    last: Instant::now(),
                    slow_until: None,
                    calls: VecDeque::new(),
                });
                let now = Instant::now();
                let rate = match b.slow_until {
                    Some(t) if t > now => self.refill_per_sec / 2.0,
                    _ => self.refill_per_sec,
                };
                b.tokens = (b.tokens + now.duration_since(b.last).as_secs_f64() * rate).min(self.capacity);
                b.last = now;
                if b.tokens >= 1.0 {
                    b.tokens -= 1.0;
                    b.calls.push_back(now);
                    while b.calls.front().is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60)) {
                        b.calls.pop_front();
                    }
                    None
                } else {
                    Some(Duration::from_secs_f64((1.0 - b.tokens) / rate))
                }
            };
            match wait {
                None => return,
                Some(d) => tokio::time::sleep(d).await,
            }
        }
    }

    /// Call after AWS returns a throttling error. Halves the rate for 30 seconds.
    pub async fn throttled(&self, profile: &str, region: &str) {
        let mut map = self.buckets.lock().await;
        if let Some(b) = map.get_mut(&(profile.to_owned(), region.to_owned())) {
            b.slow_until = Some(Instant::now() + Duration::from_secs(30));
            b.tokens = 0.0;
        }
    }

    pub async fn is_slowed(&self, profile: &str, region: &str) -> bool {
        let map = self.buckets.lock().await;
        map.get(&(profile.to_owned(), region.to_owned()))
            .and_then(|b| b.slow_until)
            .is_some_and(|t| t > Instant::now())
    }

    /// Calls in the last 60 seconds for this profile and region.
    pub async fn calls_per_min(&self, profile: &str, region: &str) -> u32 {
        let map = self.buckets.lock().await;
        let now = Instant::now();
        map.get(&(profile.to_owned(), region.to_owned()))
            .map(|b| b.calls.iter().filter(|t| now.duration_since(**t) <= Duration::from_secs(60)).count() as u32)
            .unwrap_or(0)
    }

    /// Share of the per-minute budget used, as a percentage.
    pub async fn budget_pct(&self, profile: &str, region: &str) -> u32 {
        let per_min = self.refill_per_sec * 60.0;
        ((self.calls_per_min(profile, region).await as f64 / per_min) * 100.0).round() as u32
    }
}

