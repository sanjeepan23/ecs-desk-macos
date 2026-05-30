// Mock handlers for actions, logs, metrics, and exec.
// Return undefined for a command this file does not handle, and null for a void command.

import type { Deployment, ExecCheck, ExecStart, LogLine, LogTarget, MetricPoint, ServiceMetrics, ServiceRef, Task, TaskRef } from '../types'
import { EVENTS } from '../types'
import { delay, emit } from './bus'
import {
  accountOf,
  addEvent,
  checkSession,
  emitNow,
  findService,
  findTask,
  hex,
  isReadOnly,
  makeTask,
  mockError,
  recompute,
  rng,
  taskDefinitionJson,
  world,
  type MockService,
} from './data'

type Args = Record<string, unknown>

const clone = <T>(v: T): T => structuredClone(v)

function guardWrite(profile: string) {
  checkSession(profile)
  if (isReadOnly(profile)) throw mockError('readOnly', `${profile} is read-only. Turn off read-only mode in Settings to run actions.`)
}

function requireService(t: ServiceRef): MockService {
  const svc = findService(t.profile, t.region, t.cluster, t.service)
  if (!svc) throw mockError('notFound', `Service ${t.service} was not found in ${t.cluster}.`)
  return svc
}

const isFailing = (svc: MockService | undefined, name: string) => (svc ? svc.summary.health === 'failing' : name === 'notifications')

/* ---------- Task state changes ---------- */

function markStopped(task: Task, reason: string, code = 'UserInitiated') {
  const now = Date.now()
  task.lastStatus = 'STOPPED'
  task.desiredStatus = 'STOPPED'
  task.stoppedAt = now
  task.stopReason = reason
  task.stopCode = code
  task.healthStatus = 'UNKNOWN'
  for (const c of task.containers) {
    c.lastStatus = 'STOPPED'
    c.exitCode = 0
    c.execAgentStatus = null
  }
}

function moveToStopped(svc: MockService, task: Task) {
  svc.tasks = svc.tasks.filter((t) => t !== task)
  svc.stopped.unshift(task)
  svc.stopped = svc.stopped.slice(0, 20)
}

/* ---------- Deployments ---------- */

const rollouts = new Map<string, ReturnType<typeof setInterval>>()

function digits(r: () => number, n: number) {
  return Array.from({ length: n }, () => Math.floor(r() * 10)).join('')
}

/** Starts a new PRIMARY deployment and replaces one task every 1.6 s, like ECS does. */
function startRollout(svc: MockService, rev: number, reason: string) {
  const s = svc.summary
  const now = Date.now()
  const r = rng(s.arn + now)
  const td = `arn:aws:ecs:${svc.region}:${accountOf(svc.profile)}:task-definition/${s.name}:${rev}`
  const old = s.deployments.find((d) => d.status === 'PRIMARY')
  if (old) {
    old.status = 'ACTIVE'
    if (old.rolloutState === 'IN_PROGRESS') old.rolloutState = 'FAILED'
  }
  const d: Deployment = {
    id: `ecs-svc/${digits(r, 19)}`,
    status: 'PRIMARY',
    taskDefinition: td,
    desired: s.desired,
    running: 0,
    pending: Math.min(2, s.desired),
    failed: 0,
    rolloutState: 'IN_PROGRESS',
    rolloutReason: null,
    createdAt: now,
    updatedAt: now,
  }
  s.deployments = old ? [d, old] : [d]
  s.taskDefinition = td
  s.taskDefinitionShort = `${s.name}:${rev}`
  s.health = 'deploying'
  addEvent(svc, `(service ${s.name}) ${reason}`)

  const prev = rollouts.get(s.arn)
  if (prev) clearInterval(prev)
  const oldArns = new Set(svc.tasks.map((t) => t.arn))
  const isOld = (t: Task) => oldArns.has(t.arn)

  const step = () => {
    if (d.running < d.desired) {
      const nt = makeTask(svc, r, { rev, startedAt: Date.now() })
      svc.tasks.unshift(nt)
      d.running++
      d.pending = Math.max(0, Math.min(2, d.desired - d.running))
      d.updatedAt = Date.now()
      addEvent(svc, `(service ${s.name}) has started 1 tasks: (task ${nt.id.slice(0, 8)}).`)
      const oldTask = [...svc.tasks].reverse().find(isOld)
      if (oldTask) {
        markStopped(oldTask, `Scaling activity initiated by (deployment ${d.id})`, 'ServiceSchedulerInitiated')
        moveToStopped(svc, oldTask)
        if (old) old.running = Math.max(0, old.running - 1)
      }
    }
    if (d.running >= d.desired) {
      clearInterval(rollouts.get(s.arn))
      rollouts.delete(s.arn)
      for (const t of svc.tasks.filter(isOld)) {
        markStopped(t, `Scaling activity initiated by (deployment ${d.id})`, 'ServiceSchedulerInitiated')
        moveToStopped(svc, t)
      }
      d.rolloutState = 'COMPLETED'
      d.rolloutReason = 'ECS deployment completed.'
      d.pending = 0
      s.deployments = [d]
      s.health = 'healthy'
      addEvent(svc, `(service ${s.name}) has reached a steady state.`)
    }
    recompute(svc)
    emitNow()
  }
  rollouts.set(s.arn, setInterval(step, 1600))
  emitNow()
}

function revOf(td: string): number {
  return Number((td.split('/').pop() ?? td).split(':')[1]) || 0
}

/* ---------- Actions ---------- */

function forceDeploy(t: ServiceRef) {
  guardWrite(t.profile)
  const svc = requireService(t)
  startRollout(svc, revOf(svc.summary.taskDefinition), 'has started a new deployment (forced).')
  return clone(svc.summary)
}

function rollback(t: ServiceRef, taskDefinition: string) {
  guardWrite(t.profile)
  const svc = requireService(t)
  const rev = revOf(taskDefinition)
  if (!rev) throw mockError('invalid', `${taskDefinition} is not a valid task definition.`)
  startRollout(svc, rev, `updated the task definition to ${svc.summary.name}:${rev} (rollback).`)
  return clone(svc.summary)
}

function scale(t: ServiceRef, desired: number) {
  guardWrite(t.profile)
  if (!Number.isInteger(desired) || desired < 0) throw mockError('invalid', 'The desired count must be a whole number of 0 or more.')
  const svc = requireService(t)
  const s = svc.summary
  const prev = s.desired
  s.desired = desired
  const primary = s.deployments.find((d) => d.status === 'PRIMARY')
  if (primary) primary.desired = desired
  addEvent(svc, `(service ${s.name}) desired count changed from ${prev} to ${desired}.`)
  if (desired < svc.tasks.length) {
    // ECS stops tasks that are not running first.
    const order = [...svc.tasks].sort((a, b) => Number(a.lastStatus === 'RUNNING') - Number(b.lastStatus === 'RUNNING'))
    const extra = order.slice(0, svc.tasks.length - desired)
    for (const task of extra) {
      markStopped(task, 'Scaling activity initiated by user from ECS Desk.')
      moveToStopped(svc, task)
    }
    addEvent(svc, `(service ${s.name}) has stopped ${extra.length} running tasks.`)
    if (primary) primary.running = Math.min(primary.running, desired)
  } else if (desired > svc.tasks.length) {
    const add = desired - svc.tasks.length
    s.pending = add
    setTimeout(() => {
      const r = rng(s.arn + Date.now())
      for (let i = 0; i < add; i++) svc.tasks.push(makeTask(svc, r, { startedAt: Date.now() }))
      if (primary) primary.running = Math.min(desired, svc.tasks.length)
      addEvent(svc, `(service ${s.name}) has started ${add} tasks.`)
      recompute(svc)
      emitNow()
    }, 1800)
  }
  recompute(svc)
  if (desired > svc.tasks.length) s.pending = desired - svc.tasks.length
  emitNow()
  return clone(s)
}

function stopTask(t: TaskRef, reason: string | null) {
  guardWrite(t.profile)
  const hit = findTask(t.profile, t.region, t.cluster, t.taskArn)
  if (!hit) throw mockError('notFound', 'The task was not found. It may have stopped already.')
  const { svc, task } = hit
  if (task.desiredStatus === 'STOPPED') return clone(task)
  task.desiredStatus = 'STOPPED'
  task.lastStatus = 'DEACTIVATING'
  emitNow()
  setTimeout(() => {
    markStopped(task, reason ?? 'Task stopped by user from ECS Desk.')
    moveToStopped(svc, task)
    const s = svc.summary
    addEvent(svc, `(service ${s.name}) stopped 1 running tasks: (task ${task.id.slice(0, 8)}).`)
    if (svc.tasks.length < s.desired) {
      const nt = makeTask(svc, rng(task.id + 'n'), { startedAt: Date.now() })
      svc.tasks.push(nt)
      addEvent(svc, `(service ${s.name}) has started 1 tasks: (task ${nt.id.slice(0, 8)}).`)
    }
    recompute(svc)
    emitNow()
  }, 1400)
  return clone(task)
}

/* ---------- Logs ---------- */

const LOGT: Record<string, [string, string][]> = {
  'api-gateway': [['INFO', 'GET /v1/orders 200 23ms'], ['INFO', 'POST /v1/checkout 201 118ms'], ['INFO', 'GET /v1/health 200 2ms'], ['WARN', 'upstream orders-api slow: 812ms'], ['INFO', 'GET /v1/catalog?page=3 200 41ms'], ['DEBUG', 'jwt verified sub=usr_8f2a']],
  'orders-api': [['INFO', 'order ord_29f1 created total=84.20 USD'], ['INFO', 'GET /orders/ord_77c2 200 14ms'], ['INFO', 'db pool: 18/40 in use'], ['WARN', 'retrying inventory reserve (attempt 2)'], ['INFO', 'order ord_a913 paid']],
  'payments-worker': [['INFO', 'consumed 25 messages from payments-queue'], ['INFO', 'charge ch_31aa succeeded'], ['INFO', 'worker started, revision 58'], ['WARN', 'visibility timeout extended for msg 9f2e'], ['INFO', 'charge ch_77d0 succeeded']],
  notifications: [['INFO', 'sending batch of 500 emails'], ['WARN', 'heap usage 91% (466 MiB / 512 MiB)'], ['ERROR', 'java.lang.OutOfMemoryError: Java heap space'], ['ERROR', '  at com.example.notify.TemplateCache.load(TemplateCache.java:88)'], ['WARN', 'GC overhead limit near: 97% time in GC'], ['INFO', 'loaded 1,204 templates into cache']],
  'web-frontend': [['INFO', 'GET / 200 31ms'], ['INFO', 'GET /_next/static/chunks/app.js 200 3ms'], ['INFO', 'GET /cart 200 58ms'], ['WARN', 'image optimizer cache miss']],
  'ingest-worker': [['INFO', 'batch 88213 written: 10,000 rows'], ['INFO', 'kinesis shard-0004 lag 120 ms'], ['WARN', 'throttled by DynamoDB, backoff 200ms']],
  'etl-scheduler': [['INFO', 'job nightly-rollup queued'], ['INFO', 'job hourly-sync finished in 42 s']],
  'search-indexer': [['INFO', 'indexed 2,000 docs into products-v7'], ['INFO', 'refresh interval 1s'], ['WARN', 'segment merge took 1.8 s']],
}
const GENERIC: [string, string][] = [['INFO', 'request handled 200 12ms'], ['INFO', 'health check ok'], ['DEBUG', 'cache hit ratio 0.93'], ['WARN', 'slow downstream call: 640ms']]
const OTEL: [string, string][] = [['INFO', 'Everything is ready. Begin running and processing data.'], ['INFO', 'MetricsExporter exported 118 data points'], ['DEBUG', 'TracesExporter exported 42 spans'], ['WARN', 'Exporting failed. Will retry the request after interval. error="context deadline exceeded"']]

interface TailCtx {
  profile: string
  region: string
  targets: LogTarget[]
}

const familyOf = (group: string) => group.split('/').filter(Boolean).pop() ?? group

function pickTarget(targets: LogTarget[], r: () => number): LogTarget {
  // Sidecars log less than the app container.
  const app = targets.filter((t) => t.container === familyOf(t.group))
  if (app.length && r() < 0.88) return app[Math.floor(r() * app.length)]
  return targets[Math.floor(r() * targets.length)]
}

function genLine(ctx: TailCtx, t: number, r: () => number): LogLine {
  const target = pickTarget(ctx.targets, r)
  const family = familyOf(target.group)
  const svc = world(ctx.profile, ctx.region)
    .flatMap((c) => c.services)
    .find((s) => s.summary.name === family)
  const container = target.container ?? family
  const tpl = container === 'otel-collector' ? OTEL : (LOGT[family] ?? GENERIC)
  const failing = container !== 'otel-collector' && isFailing(svc, family)
  const pick = failing && r() < 0.45 ? tpl[2 + Math.floor(r() * 2)] : tpl[Math.floor(r() * tpl.length)]
  const tasks = svc?.tasks.length ? svc.tasks : null
  const taskId = tasks ? tasks[Math.floor(r() * tasks.length)].id : hex(rng(family), 32)
  return {
    timestamp: t,
    level: pick[0],
    message: pick[1],
    group: target.group,
    stream: `${target.streamPrefix ?? 'ecs'}/${container}/${taskId}`,
  }
}

/** A small subset of CloudWatch filter patterns: all terms must occur, and "-term" excludes. */
function matchesFilter(msg: string, filter: string | null | undefined): boolean {
  if (!filter) return true
  const terms = (filter.match(/"[^"]*"|\S+/g) ?? []).map((x) => x.replace(/^"|"$/g, '').toLowerCase()).filter(Boolean)
  const m = msg.toLowerCase()
  return terms.every((x) => (x.startsWith('-') && x.length > 1 ? !m.includes(x.slice(1)) : m.includes(x)))
}

function resolveTargets(profile: string, region: string, taskDefinition: string): LogTarget[] {
  const td = taskDefinitionJson(profile, region, taskDefinition)
  if (!td) {
    const family = (taskDefinition.split('/').pop() ?? taskDefinition).split(':')[0]
    return [{ group: `/ecs/${family}`, streamPrefix: 'ecs', container: family }]
  }
  const defs = (td.containerDefinitions as { name: string; logConfiguration?: { logDriver: string; options?: Record<string, string> } }[]) ?? []
  return defs
    .filter((c) => c.logConfiguration?.logDriver === 'awslogs' && c.logConfiguration.options?.['awslogs-group'])
    .map((c) => ({
      group: c.logConfiguration!.options!['awslogs-group'],
      streamPrefix: c.logConfiguration!.options!['awslogs-stream-prefix'] ?? null,
      container: c.name,
    }))
}

const tails = new Map<string, ReturnType<typeof setInterval>>()

function startTail(sessionId: string, ctx: TailCtx, filter: string | null) {
  stopTail(sessionId)
  if (!ctx.targets.length) throw mockError('invalid', 'No log targets to tail.')
  tails.set(
    sessionId,
    setInterval(() => {
      const line = genLine(ctx, Date.now(), Math.random)
      if (matchesFilter(line.message, filter)) emit(EVENTS.logLines, { sessionId, lines: [line] })
    }, 700),
  )
}

function stopTail(sessionId: string) {
  clearInterval(tails.get(sessionId))
  tails.delete(sessionId)
}

function searchLogs(ctx: TailCtx, filter: string | null, startMs: number, endMs: number, limit: number | null): LogLine[] {
  const step = 1700
  const out: LogLine[] = []
  const key = ctx.targets.map((x) => x.group + x.container).join(',')
  // Fixed time slots, so the same window always gives the same lines.
  for (let t = Math.ceil(startMs / step) * step; t <= endMs; t += step) {
    const line = genLine(ctx, t, rng('slot' + t + key))
    if (matchesFilter(line.message, filter)) out.push(line)
  }
  return out.slice(-(limit ?? 1000))
}

/* ---------- Metrics ---------- */

function series(seed: string, base: number, kind: 'cpu' | 'mem', failing: boolean, n: number, periodMs: number): MetricPoint[] {
  const r = rng(seed)
  const end = Math.floor(Date.now() / periodMs) * periodMs
  let v = base
  const out: MetricPoint[] = []
  for (let i = 0; i < n; i++) {
    if (failing && kind === 'mem') v = Math.min(99, (i % 14) * 6.5 + 30 + r() * 4)
    else {
      v += (r() - 0.5) * 7 + (base - v) * 0.15
      if (kind === 'cpu' && r() < 0.05) v += 18
    }
    out.push({ t: end - (n - 1 - i) * periodMs, v: Math.max(1, Math.min(100, Math.round(v * 10) / 10)) })
  }
  return out
}

function getMetrics(profile: string, region: string, cluster: string, service: string, rangeMinutes: number): ServiceMetrics {
  checkSession(profile)
  const svc = findService(profile, region, cluster, service)
  const periodSecs = rangeMinutes <= 60 ? 60 : rangeMinutes <= 360 ? 300 : rangeMinutes <= 1440 ? 900 : 3600
  const n = Math.max(2, Math.round((rangeMinutes * 60) / periodSecs))
  const r = rng('base' + service)
  const cpuBase = svc?.cpuBase ?? 10 + Math.floor(r() * 50)
  const memBase = svc?.memBase ?? 25 + Math.floor(r() * 45)
  const failing = isFailing(svc, service)
  const seed = profile + cluster + service + rangeMinutes
  return {
    cpu: series(seed + 'cpu', cpuBase, 'cpu', false, n, periodSecs * 1000),
    memory: series(seed + 'mem', memBase, 'mem', failing, n, periodSecs * 1000),
    periodSecs,
  }
}

/* ---------- Exec: a small fake shell ---------- */

interface ExecSession {
  req: ExecStart
  line: string
  /** True while the input is inside an escape sequence, such as an arrow key. */
  inEscape: boolean
  port: number | null
  rev: number
  startedAt: number
  env: string
}

const execs = new Map<string, ExecSession>()
const PROMPT = '\x1b[32m/app #\x1b[0m '
const dim = (s: string) => `\x1b[90m${s}\x1b[0m`
const out = (sessionId: string, data: string) => emit(EVENTS.execOutput, { sessionId, data })

function execCheck(profile: string, region: string, cluster: string, taskArn: string, container: string): ExecCheck {
  checkSession(profile)
  const problems: string[] = []
  const hit = findTask(profile, region, cluster, taskArn)
  if (!hit) problems.push('The task was not found. It may have stopped.')
  else {
    const { task } = hit
    const c = task.containers.find((x) => x.name === container)
    if (task.lastStatus !== 'RUNNING') problems.push(`The task is ${task.lastStatus}. Exec needs a running task.`)
    if (!task.enableExecuteCommand)
      problems.push(`enableExecuteCommand is false on ${hit.svc.summary.name}. Turn it on for the service, then force a new deployment.`)
    if (!c) problems.push(`The task has no container named ${container}.`)
    else if (task.enableExecuteCommand && c.execAgentStatus !== 'RUNNING')
      problems.push(`The ExecuteCommandAgent in ${container} is ${c.execAgentStatus ?? 'not running'}.`)
  }
  return { ok: problems.length === 0, problems, pluginPath: '/usr/local/bin/session-manager-plugin' }
}

function runCommand(s: ExecSession, raw: string): string | { exit: true } | { clear: true } {
  const c = raw.trim()
  if (!c) return ''
  if (c === 'help') return 'Try: ls, ps, env, df -h, cat /etc/os-release, curl localhost/health, clear, exit'
  if (c === 'ls') return 'bin  config  node_modules  package.json  server.js  templates'
  if (c === 'ps' || c === 'ps aux')
    return 'PID   USER     TIME  COMMAND\n    1 app       2:14 node server.js\n   48 root      0:00 /managed-agents/execute-command/ssm-agent-worker\n   61 app       0:00 /bin/sh\n   62 app       0:00 ps'
  if (c === 'env')
    return `APP_ENV=${s.env}\nLOG_LEVEL=info\nAWS_REGION=${s.req.region}\nECS_CONTAINER_METADATA_URI_V4=http://169.254.170.2/v4/${(s.req.taskArn.split('/').pop() ?? '').slice(0, 12)}\nDATABASE_URL=********`
  if (c === 'df -h') return 'Filesystem   Size  Used Avail Use% Mounted on\noverlay       30G  6.1G   22G  22% /'
  if (c === 'cat /etc/os-release') return 'NAME="Alpine Linux"\nVERSION_ID=3.20.3\nPRETTY_NAME="Alpine Linux v3.20"'
  if (c === 'curl' || c.startsWith('curl '))
    return s.port
      ? `{"status":"ok","revision":${s.rev},"uptime_s":${Math.round((Date.now() - s.startedAt) / 1000)}}`
      : 'curl: (7) Failed to connect to localhost port 80: Connection refused'
  if (c === 'clear') return { clear: true }
  if (c === 'exit') return { exit: true }
  return `/bin/sh: ${c.split(' ')[0]}: not found`
}

function endExec(sessionId: string, code: number | null) {
  if (!execs.delete(sessionId)) return
  emit(EVENTS.execExit, { sessionId, code })
}

function execWrite(sessionId: string, data: string) {
  const s = execs.get(sessionId)
  if (!s) throw mockError('notFound', 'The exec session has ended.')
  for (const ch of Array.from(data)) {
    if (s.inEscape) {
      // A CSI sequence ends with a byte from @ to ~. The "[" after ESC does not end it.
      if (ch !== '[' && ch >= '@' && ch <= '~') s.inEscape = false
      continue
    }
    if (ch === '\x1b') s.inEscape = true
    else if (ch === '\r' || ch === '\n') {
      const res = runCommand(s, s.line)
      s.line = ''
      if (typeof res === 'string') out(sessionId, '\r\n' + (res ? res.replace(/\n/g, '\r\n') + '\r\n' : '') + PROMPT)
      else if ('clear' in res) out(sessionId, '\x1b[2J\x1b[3J\x1b[H' + PROMPT)
      else {
        out(sessionId, '\r\n\r\n' + dim(`Exiting session with sessionId: ecs-execute-command-${sessionId.slice(0, 8)}.`) + '\r\n')
        setTimeout(() => endExec(sessionId, 0), 150)
        return
      }
    } else if (ch === '\x7f' || ch === '\b') {
      if (s.line) {
        s.line = Array.from(s.line).slice(0, -1).join('')
        out(sessionId, '\b \b')
      }
    } else if (ch === '\x03') {
      s.line = ''
      out(sessionId, '^C\r\n' + PROMPT)
    } else if (ch === '\x04') {
      if (!s.line) {
        out(sessionId, 'exit\r\n')
        setTimeout(() => endExec(sessionId, 0), 150)
        return
      }
    } else if (ch === '\x0c') out(sessionId, '\x1b[2J\x1b[H' + PROMPT + s.line)
    else if (ch === '\t' || ch >= ' ') {
      const c = ch === '\t' ? ' ' : ch
      s.line += c
      out(sessionId, c)
    }
  }
}

