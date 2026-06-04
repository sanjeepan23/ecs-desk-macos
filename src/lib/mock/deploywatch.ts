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

