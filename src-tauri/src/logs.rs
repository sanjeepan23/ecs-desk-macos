//! CloudWatch Logs live tail and search. Emits `logs://lines`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use aws_sdk_cloudwatchlogs::operation::start_live_tail::StartLiveTailOutput;
use aws_sdk_cloudwatchlogs::types::StartLiveTailResponseStream;
use aws_sdk_ecs::types::LogDriver;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

use crate::error::{aws_err, AppError, AppResult};
use crate::models::{events, LogBatch, LogLine, LogTarget};
use crate::ops::fail;
use crate::state::AppState;

/// StartLiveTail accepts at most 10 log groups per session.
const MAX_TAIL_GROUPS: usize = 10;
const FLUSH_EVERY: Duration = Duration::from_millis(250);
const FLUSH_LINES: usize = 200;
const DEFAULT_SEARCH_LIMIT: i32 = 500;
const MAX_SEARCH_PAGES: usize = 50;

#[derive(Default)]
pub struct TailRegistry {
    /// session_id → (generation, task). The generation stops an old task from acting for a new one.
    tails: std::sync::Mutex<HashMap<String, (u64, JoinHandle<()>)>>,
    next_gen: AtomicU64,
    /// profile → AWS account ID, from STS GetCallerIdentity.
    accounts: tokio::sync::Mutex<HashMap<String, String>>,
}

impl TailRegistry {
    fn insert(&self, session_id: String, generation: u64, handle: JoinHandle<()>) {
        let old = self.tails.lock().unwrap().insert(session_id, (generation, handle));
        if let Some((_, h)) = old {
            h.abort();
        }
    }

    fn is_current(&self, session_id: &str, generation: u64) -> bool {
        self.tails.lock().unwrap().get(session_id).is_some_and(|(g, _)| *g == generation)
    }

    fn remove(&self, session_id: &str) {
        if let Some((_, h)) = self.tails.lock().unwrap().remove(session_id) {
            h.abort();
        }
    }
}

/// Guesses a log level. JSON level fields win over words in the text.
pub fn guess_level(message: &str) -> &'static str {
    if let Some(level) = json_level(message) {
        return level;
    }
    let m = message.to_ascii_lowercase();
    if ["error", "exception", "fatal", "panic"].iter().any(|w| m.contains(w)) {
        "ERROR"
    } else if m.contains("warn") {
        "WARN"
    } else if m.contains("debug") || m.contains("trace") {
        "DEBUG"
    } else {
        "INFO"
    }
}

fn json_level(message: &str) -> Option<&'static str> {
    let trimmed = message.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = v.as_object()?;
    let raw = ["level", "severity", "lvl", "levelname", "log.level", "loglevel"]
        .iter()
        .find_map(|k| obj.get(*k))?;
    let text = match raw {
        serde_json::Value::String(s) => s.to_ascii_lowercase(),
        // Pino and Bunyan use numbers: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal.
        serde_json::Value::Number(n) => {
            return n.as_i64().map(|n| match n {
                i64::MIN..=29 => "DEBUG",
                30..=39 => "INFO",
                40..=49 => "WARN",
                _ => "ERROR",
            })
        }
        _ => return None,
    };
    match text.as_str() {
        "error" | "err" | "fatal" | "critical" | "crit" | "panic" | "alert" | "emerg" | "emergency" => Some("ERROR"),
        "warn" | "warning" => Some("WARN"),
        "debug" | "trace" | "verbose" => Some("DEBUG"),
        "info" | "information" | "notice" => Some("INFO"),
        _ => None,
    }
}

/// The awslogs stream name is "<prefix>/<container>/<task-id>".
fn stream_prefix(t: &LogTarget) -> Option<String> {
    let prefix = t.stream_prefix.as_deref().filter(|p| !p.is_empty())?;
    Some(match t.container.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => format!("{prefix}/{c}/"),
        None => format!("{prefix}/"),
    })
}

/// Unique (group, stream prefix) pairs to search. A target with no prefix covers its whole group.
fn search_scopes(targets: &[LogTarget]) -> Vec<(String, Option<String>)> {
    let mut groups: Vec<String> = Vec::new();
    for t in targets {
        if !groups.contains(&t.group) {
            groups.push(t.group.clone());
        }
    }
    let mut scopes = Vec::new();
    for g in groups {
        let in_group: Vec<&LogTarget> = targets.iter().filter(|t| t.group == g).collect();
        let prefixes: Vec<Option<String>> = in_group.iter().map(|t| stream_prefix(t)).collect();
        if prefixes.iter().any(Option::is_none) {
            scopes.push((g, None));
            continue;
        }
        let mut seen: Vec<String> = Vec::new();
        for p in prefixes.into_iter().flatten() {
            if !seen.contains(&p) {
                seen.push(p.clone());
                scopes.push((g.clone(), Some(p)));
            }
        }
    }
    scopes
}

/// Log groups and stream prefixes for one live tail. Prefixes are allowed only with one group.
fn tail_scope(targets: &[LogTarget]) -> (Vec<String>, Vec<String>) {
    let scopes = search_scopes(targets);
    let mut groups: Vec<String> = Vec::new();
    for (g, _) in &scopes {
        if !groups.contains(g) {
            groups.push(g.clone());
        }
    }
    let prefixes = if groups.len() == 1 && scopes.iter().all(|(_, p)| p.is_some()) {
        scopes.into_iter().filter_map(|(_, p)| p).collect()
    } else {
        Vec::new()
    };
    (groups, prefixes)
}

fn partition(region: &str) -> &'static str {
    if region.starts_with("cn-") {
        "aws-cn"
    } else if region.starts_with("us-gov-") {
        "aws-us-gov"
    } else {
        "aws"
    }
}

/// StartLiveTail needs the group ARN without the trailing ":*".
fn log_group_arn(region: &str, account: &str, group: &str) -> String {
    if group.starts_with("arn:") {
        return group.trim_end_matches(":*").to_owned();
    }
    format!("arn:{}:logs:{region}:{account}:log-group:{group}", partition(region))
}

/// Live tail events name the group by ARN. The UI wants the plain name.
fn group_name(identifier: &str) -> String {
    match identifier.split_once(":log-group:") {
        Some((_, name)) => name.trim_end_matches(":*").to_owned(),
        None => identifier.to_owned(),
    }
}

fn line(timestamp: i64, message: &str, group: String, stream: String) -> LogLine {
    LogLine {
        timestamp,
        level: guess_level(message).to_owned(),
        message: message.trim_end_matches(['\r', '\n']).to_owned(),
        group,
        stream,
    }
}

#[tauri::command]
pub async fn resolve_log_targets(
    state: State<'_, AppState>,
    profile: String,
    region: String,
    task_definition: String,
) -> AppResult<Vec<LogTarget>> {
    let ctx = state.clients.get(&profile, &region).await;
    state.limiter.acquire(&profile, &region).await;
    let out = match ctx.ecs.describe_task_definition().task_definition(&task_definition).send().await {
        Ok(o) => o,
        Err(e) => return Err(fail(&state, &profile, &region, e).await),
    };
    let td = out
        .task_definition()
        .ok_or_else(|| AppError::internal("DescribeTaskDefinition returned no task definition."))?;
    let targets: Vec<LogTarget> = td
        .container_definitions()
        .iter()
        .filter_map(|c| {
            let lc = c.log_configuration()?;
            if lc.log_driver() != &LogDriver::Awslogs {
                return None;
            }
            let opts = lc.options()?;
            Some(LogTarget {
                group: opts.get("awslogs-group")?.clone(),
                stream_prefix: opts.get("awslogs-stream-prefix").cloned(),
                container: c.name().map(str::to_owned),
            })
        })
        .collect();
    if targets.is_empty() {
        return Err(AppError::invalid(format!(
            "No container in {task_definition} uses the awslogs log driver. ECS Desk can only read logs from awslogs."
        )));
    }
    Ok(targets)
}

async fn account_id(state: &AppState, profile: &str, region: &str) -> AppResult<String> {
    if let Some(a) = state.tails.accounts.lock().await.get(profile) {
        return Ok(a.clone());
    }
    let ctx = state.clients.get(profile, region).await;
    state.limiter.acquire(profile, region).await;
    let out = match ctx.sts.get_caller_identity().send().await {
        Ok(o) => o,
        Err(e) => return Err(fail(state, profile, region, e).await),
    };
    let account = out
        .account()
        .ok_or_else(|| AppError::internal("GetCallerIdentity returned no account."))?
        .to_owned();
    state.tails.accounts.lock().await.insert(profile.to_owned(), account.clone());
    Ok(account)
}

struct TailSpec {
    session_id: String,
    generation: u64,
    profile: String,
    region: String,
    arns: Vec<String>,
    prefixes: Vec<String>,
    filter: Option<String>,
}

async fn open_tail(state: &AppState, spec: &TailSpec) -> AppResult<StartLiveTailOutput> {
    let ctx = state.clients.get(&spec.profile, &spec.region).await;
    state.limiter.acquire(&spec.profile, &spec.region).await;
    let mut req = ctx.logs.start_live_tail().set_log_group_identifiers(Some(spec.arns.clone()));
    if !spec.prefixes.is_empty() {
        req = req.set_log_stream_name_prefixes(Some(spec.prefixes.clone()));
    }
    if let Some(f) = &spec.filter {
        req = req.log_event_filter_pattern(f);
    }
    match req.send().await {
        Ok(o) => Ok(o),
        Err(e) => Err(fail(state, &spec.profile, &spec.region, e).await),
    }
}

/// Reads live tail sessions and opens a new one when a session ends.
async fn read_tails(app: AppHandle, spec: TailSpec, first: StartLiveTailOutput, tx: mpsc::UnboundedSender<LogLine>) {
    let state = app.state::<AppState>();
    let mut next = Some(first);
    let mut backoff = Duration::from_secs(1);
    loop {
        let out = match next.take() {
            Some(o) => o,
            None => {
                if !state.tails.is_current(&spec.session_id, spec.generation) {
                    return;
                }
                match open_tail(&state, &spec).await {
                    Ok(o) => o,
                    Err(e) => {
                        log::warn!("live tail {} restart failed: {}", spec.session_id, e.message);
                        tokio::time::sleep(backoff).await;
                        backoff = (backoff * 2).min(Duration::from_secs(60));
                        continue;
                    }
                }
            }
        };
        let mut stream = out.response_stream;
        loop {
            match stream.recv().await {
                Ok(Some(StartLiveTailResponseStream::SessionStart(_))) => backoff = Duration::from_secs(1),
                Ok(Some(StartLiveTailResponseStream::SessionUpdate(u))) => {
                    for ev in u.session_results() {
                        let l = line(
                            ev.timestamp().unwrap_or_default(),
                            ev.message().unwrap_or_default(),
                            group_name(ev.log_group_identifier().unwrap_or_default()),
                            ev.log_stream_name().unwrap_or_default().to_owned(),
                        );
                        if tx.send(l).is_err() {
                            return;
                        }
                    }
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(e) => {
                    log::warn!("live tail {} stream error: {}", spec.session_id, aws_err(e).message);
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(Duration::from_secs(60));
                    break;
                }
            }
        }
    }
}

/// Sends lines as `logs://lines` batches every 250 ms or every 200 lines.
async fn flush_lines(app: AppHandle, session_id: String, mut rx: mpsc::UnboundedReceiver<LogLine>) {
    let mut buf: Vec<LogLine> = Vec::new();
    let mut tick = tokio::time::interval(FLUSH_EVERY);
    let emit = |buf: &mut Vec<LogLine>| {
        if buf.is_empty() {
            return;
        }
        let batch = LogBatch { session_id: session_id.clone(), lines: std::mem::take(buf) };
        if let Err(e) = app.emit(events::LOG_LINES, batch) {
            log::warn!("emit {} failed: {e}", events::LOG_LINES);
        }
    };
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Some(l) => {
                    buf.push(l);
                    if buf.len() >= FLUSH_LINES {
                        emit(&mut buf);
                    }
                }
                None => {
                    emit(&mut buf);
                    return;
                }
            },
            _ = tick.tick() => emit(&mut buf),
        }
    }
}

#[tauri::command]
pub async fn start_log_tail(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    profile: String,
    region: String,
    targets: Vec<LogTarget>,
    filter: Option<String>,
) -> AppResult<()> {
    let (mut groups, prefixes) = tail_scope(&targets);
    if groups.is_empty() {
        return Err(AppError::invalid("Choose at least one log group to tail."));
    }
    if groups.len() > MAX_TAIL_GROUPS {
        log::warn!("live tail {session_id}: using the first {MAX_TAIL_GROUPS} of {} log groups", groups.len());
        groups.truncate(MAX_TAIL_GROUPS);
    }
    let account = account_id(&state, &profile, &region).await?;
    let arns = groups.iter().map(|g| log_group_arn(&region, &account, g)).collect();
    let spec = TailSpec {
        session_id: session_id.clone(),
        generation: state.tails.next_gen.fetch_add(1, Ordering::Relaxed),
        profile,
        region,
        arns,
        prefixes,
        filter: filter.map(|f| f.trim().to_owned()).filter(|f| !f.is_empty()),
    };
    // Open the first session here so that errors go back to the UI.
    let first = open_tail(&state, &spec).await?;
    let generation = spec.generation;
    let (tx, rx) = mpsc::unbounded_channel();
    let reader = read_tails(app.clone(), spec, first, tx);
    let flusher = flush_lines(app.clone(), session_id.clone(), rx);
    let handle = tauri::async_runtime::spawn(async move {
        tokio::join!(reader, flusher);
    });
    state.tails.insert(session_id, generation, handle);
    Ok(())
}

