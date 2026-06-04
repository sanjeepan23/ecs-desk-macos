// Browser mock handlers for this feature.
// Return undefined for a command this file does not handle, and null for a void command.

import type { Deployment, DeployWatch, ServiceEvent, ServiceRef, Task, WatchPhase } from '../types'
import { EVENTS } from '../types'
import { delay, emit } from './bus'
import { checkSession, findService, mockError, type MockService } from './data'

// The real backend polls every 5 s. The mock is faster, so a demo rollout shows more steps.
const POLL_MS = 2000
const TIMEOUT_MS = 60 * 60 * 1000
const KEEP_FINISHED_MS = 30 * 60 * 1000
const LOOKBACK_MS = 30 * 1000

interface Entry {
  watch: DeployWatch
  timer: ReturnType<typeof setInterval> | null
  /** Creation time of the watched deployment. Tasks that started before it are old tasks. */
  deployCreatedAt: number
  /** Wall time when the watch began. The timeout counts from it. */
  begunAt: number
}

const entries = new Map<string, Entry>()
const clone = <T>(v: T): T => structuredClone(v)

const idOf = (t: ServiceRef) => `${t.profile}/${t.region}/${t.cluster}/${t.service}`
const primaryOf = (deps: Deployment[]) => deps.find((d) => d.status === 'PRIMARY') ?? deps[0]
const tdName = (td: string) => td.split('/').pop() ?? td

function prune() {
  const now = Date.now()
  for (const [id, e] of entries) if (e.watch.finishedAt != null && now - e.watch.finishedAt >= KEEP_FINISHED_MS) entries.delete(id)
}

/** Same rules as `decide_phase` in deploywatch.rs. */
function decide(w: DeployWatch, deps: Deployment[], elapsed: number): WatchPhase {
  const watched = w.deploymentId ? deps.find((d) => d.id === w.deploymentId) : primaryOf(deps)
  const primary = deps.find((d) => d.status === 'PRIMARY')
  if (watched && watched.status === 'PRIMARY') {
    if (watched.rolloutState === 'FAILED') return 'failed'
    if (watched.rolloutState === 'COMPLETED' && watched.running === watched.desired && watched.pending === 0) return 'completed'
    if (watched.rolloutState == null && deps.length === 1 && watched.running === watched.desired) return 'completed'
  } else {
    const rollbackEvent = w.events.some((e) => /circuit breaker|rolling back|rolled back/i.test(e.message))
    if ((primary && primary.id !== watched?.id) || rollbackEvent) return 'rolledBack'
    if (watched?.rolloutState === 'FAILED') return 'failed'
  }
  return elapsed >= TIMEOUT_MS ? 'timedOut' : 'inProgress'
}

function message(phase: WatchPhase, w: DeployWatch): string | null {
  const td = tdName(w.taskDefinition)
  switch (phase) {
    case 'completed':
      return `${td} is running on ${w.running} of ${w.desired} tasks.`
    case 'failed':
      return `The rollout of ${td} failed with ${w.failed} failed tasks.`
    case 'rolledBack':
      return `ECS rolled back or replaced the deployment of ${td}.`
    case 'timedOut':
      return `The rollout of ${td} did not finish in 60 minutes.`
    case 'cancelled':
      return 'You stopped watching this rollout.'
    default:
      return null
  }
}

function newEvents(old: ServiceEvent[], all: ServiceEvent[], since: number): ServiceEvent[] {
  const ids = new Set(old.map((e) => e.id))
  const add = all.filter((e) => (e.createdAt ?? 0) >= since && !ids.has(e.id))
  return [...old, ...add].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 100)
}

function failedTasks(svc: MockService, w: DeployWatch, deployCreatedAt: number): Task[] {
  return svc.stopped
    .filter((t) => t.taskDefinition === w.taskDefinition && (t.stoppedAt ?? 0) >= w.startedAt && (t.startedAt == null || t.startedAt >= deployCreatedAt))
    .sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0))
    .slice(0, 10)
}

const keyOf = (w: DeployWatch) =>
  JSON.stringify([w.phase, w.desired, w.running, w.pending, w.failed, w.events.map((e) => e.id), w.failedTasks.map((t) => t.arn)])

/** Copies the counts of the watched deployment and adds new events. */
function apply(w: DeployWatch, svc: MockService) {
  const deps = svc.summary.deployments
  const d = w.deploymentId ? deps.find((x) => x.id === w.deploymentId) : primaryOf(deps)
  if (d) {
    w.desired = d.desired
    w.running = d.running
    w.pending = d.pending
    w.failed = d.failed
  }
  w.events = newEvents(w.events, svc.events, w.startedAt)
}

function tick(id: string) {
  const e = entries.get(id)
  if (!e || e.watch.phase !== 'inProgress') return
  const w = e.watch
  const before = keyOf(w)
  const svc = findService(w.target.profile, w.target.region, w.target.cluster, w.target.service)
  if (svc) {
    apply(w, svc)
    w.failedTasks = failedTasks(svc, w, e.deployCreatedAt)
    w.phase = decide(w, svc.summary.deployments, Date.now() - e.begunAt)
  }
  if (w.phase !== 'inProgress') {
    w.finishedAt = Date.now()
    w.message = message(w.phase, w)
    clearInterval(e.timer ?? undefined)
    e.timer = null
  }
  if (keyOf(w) === before) return
  w.updatedAt = Date.now()
  emit(EVENTS.deployWatch, clone(w))
}

function watch(target: ServiceRef): DeployWatch {
  checkSession(target.profile)
  prune()
  const id = idOf(target)
  const running = entries.get(id)
  if (running?.watch.phase === 'inProgress') return clone(running.watch)
  const svc = findService(target.profile, target.region, target.cluster, target.service)
  if (!svc) throw mockError('notFound', `Service ${target.service} was not found in ${target.cluster}.`)
  const now = Date.now()
  const d = primaryOf(svc.summary.deployments)
  const startedAt = d?.rolloutState === 'IN_PROGRESS' && d.createdAt != null ? Math.min(d.createdAt, now) : now - LOOKBACK_MS
  const w: DeployWatch = {
    id,
    target: clone(target),
    deploymentId: d?.id ?? null,
    taskDefinition: d?.taskDefinition ?? svc.summary.taskDefinition,
    phase: 'inProgress',
    desired: 0,
    running: 0,
    pending: 0,
    failed: 0,
    startedAt,
    updatedAt: now,
    finishedAt: null,
    events: [],
    failedTasks: [],
    message: null,
  }
  apply(w, svc)
  entries.set(id, { watch: w, timer: setInterval(() => tick(id), POLL_MS), deployCreatedAt: d?.createdAt ?? startedAt, begunAt: now })
  const out = clone(w)
  emit(EVENTS.deployWatch, out)
  return out
}

function unwatch(id: string) {
  const e = entries.get(id)
  if (!e) return
  clearInterval(e.timer ?? undefined)
  e.timer = null
  if (e.watch.phase !== 'inProgress') return
  const now = Date.now()
  Object.assign(e.watch, { phase: 'cancelled', finishedAt: now, updatedAt: now, message: message('cancelled', e.watch) })
  emit(EVENTS.deployWatch, clone(e.watch))
}

export async function handleDeployWatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case 'watch_deployment':
      await delay(150)
      return watch(args.target as ServiceRef)
    case 'list_watches':
      await delay(60)
      prune()
      return [...entries.values()].map((e) => clone(e.watch)).sort((a, b) => b.startedAt - a.startedAt)
    case 'unwatch':
      unwatch(String(args.id))
      return null
    default:
      return undefined
  }
}
