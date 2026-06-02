// Pure helpers for deployment watches. They do not read global state.

import type { Tone } from '@/lib/status'
import type { DeployWatch, ServiceRef, WatchPhase } from '@/lib/types'

export const PHASE_META: Record<WatchPhase, { label: string; tone: Tone; verb: string }> = {
  inProgress: { label: 'In progress', tone: 'info', verb: 'is in progress' },
  completed: { label: 'Completed', tone: 'ok', verb: 'completed' },
  failed: { label: 'Failed', tone: 'crit', verb: 'failed' },
  rolledBack: { label: 'Rolled back', tone: 'warn', verb: 'rolled back' },
  timedOut: { label: 'Timed out', tone: 'warn', verb: 'timed out' },
  cancelled: { label: 'Not watched', tone: 'neutral', verb: 'is no longer watched' },
}

export function phaseMeta(phase: WatchPhase) {
  return PHASE_META[phase] ?? { label: phase, tone: 'neutral' as Tone, verb: phase }
}

export const isRunning = (w: DeployWatch) => w.phase === 'inProgress'

/** Same format as the backend: "<profile>/<region>/<cluster>/<service>". */
export function watchId(t: ServiceRef): string {
  return `${t.profile}/${t.region}/${t.cluster}/${t.service}`
}

/** Duration as "45 s", "3 min 05 s", or "1 h 02 min". */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/** Time from start to finish, or to `now` while the watch runs. */
export function watchElapsed(w: DeployWatch, now: number): number {
  return (w.finishedAt ?? now) - w.startedAt
}

/** Running watches first, then newest first. */
export function sortWatches(list: DeployWatch[]): DeployWatch[] {
  return [...list].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || b.startedAt - a.startedAt)
}

/**
 * Adds or replaces a watch by id, and removes it when it is cancelled.
 * An older update or a running update of a finished run does not replace the stored watch.
 */
export function mergeWatch(list: DeployWatch[], w: DeployWatch): DeployWatch[] {
  const i = list.findIndex((x) => x.id === w.id)
  if (w.phase === 'cancelled') return i < 0 ? list : list.filter((x) => x.id !== w.id)
  if (i < 0) return sortWatches([...list, w])
  const old = list[i]
  const sameRun = old.startedAt === w.startedAt
  if (sameRun && (w.updatedAt < old.updatedAt || (!isRunning(old) && isRunning(w)))) return list
  const next = [...list]
  next[i] = w
  return sortWatches(next)
}

/** True when this update ends a watch that the list still shows as running. */
export function justFinished(list: DeployWatch[], w: DeployWatch): boolean {
  const old = list.find((x) => x.id === w.id)
  return !isRunning(w) && !!old && isRunning(old) && old.startedAt === w.startedAt
}

export function progressPct(w: Pick<DeployWatch, 'running' | 'desired'>): number {
  if (w.desired <= 0) return w.running <= 0 ? 100 : 0
  return Math.min(100, Math.round((w.running / w.desired) * 100))
}
