// Browser mock handlers for this feature.
// Return undefined for a command this file does not handle, and null for a void command.

import { CATEGORY_META } from '../../features/stopped/categories'
import type { ServiceEvent, StopCategory, StopGroup, StoppedAnalysis, Task } from '../types'
import { delay } from './bus'
import { checkSession, findService, mockError } from './data'

// The mock world does not age, so the crash-loop window ends when the world was built.
const MOCK_T0 = Date.now()
const CRASH_WINDOW_MS = 15 * 60_000

/** Same rules as `classify` in src-tauri/src/analysis.rs, in the same order. */
export function classifyTask(t: Task): StopCategory {
  const text = [t.stopReason, ...t.containers.map((c) => c.reason)].filter(Boolean).join(' | ').toLowerCase()
  const code = t.stopCode ?? ''
  const has = (s: string) => text.includes(s)
  const words = text.split(/[^a-z0-9]+/)
  if (code === 'SpotInterruption' || code === 'TerminationNotice' || has('spot interruption')) return 'spotInterruption'
  const exit137 = t.containers.some((c) => c.exitCode === 137)
  if (has('outofmemory') || has('oomkilled') || (exit137 && (words.includes('oom') || has('memory')))) return 'outOfMemory'
  if (has('cannotpullcontainer') || has('pull image') || has('pull access denied') || has('manifest unknown')) return 'imagePull'
  if (has('resourceinitializationerror') && (has('secret') || has('ssm') || has('parameter') || has('kms'))) return 'secrets'
  if (has('health check')) return 'healthCheck'
  if (has('resource:') || has('no container instances') || has('capacity provider') || has('insufficient capacity')) return 'capacity'
  if (
    words.includes('eni') ||
    has('subnet') ||
    has('network interface') ||
    ((has('cannotstartcontainererror') || has('resourceinitializationerror')) && has('network'))
  )
    return 'network'
  if (has('ecs deployment') || has('initiated by (deployment') || has('initiated by deployment')) return 'deployment'
  if (has('scaling activity initiated by') || (code === 'ServiceSchedulerInitiated' && /scale-in|scale in|scaling/.test(text))) return 'scaleIn'
  if (code === 'UserInitiated') return 'userStopped'
  if (code === 'EssentialContainerExited' || has('essential container in task exited')) return 'essentialExit'
  return 'other'
}

/** Groups stopped tasks like the backend does. Tasks must have their final stop times. */
export function analyzeTasks(tasks: Task[], now: number): StoppedAnalysis {
  const sorted = [...tasks].sort((a, b) => (b.stoppedAt ?? 0) - (a.stoppedAt ?? 0))
  const groups = new Map<StopCategory, StopGroup>()
  let recent = 0
  for (const t of sorted) {
    const category = classifyTask(t)
    const meta = CATEGORY_META[category]
    if (!meta.expected && t.stoppedAt != null && now - t.stoppedAt <= CRASH_WINDOW_MS) recent++
    let g = groups.get(category)
    if (!g) {
      const reason = t.containers.find((c) => c.reason)
      const stop = t.stopReason ?? ''
      const sampleReason = reason?.reason && !stop.includes(reason.reason) ? `${stop ? stop + '. ' : ''}${reason.name}: ${reason.reason}` : stop
      g = { category, title: meta.label, count: 0, lastSeen: t.stoppedAt, taskArns: [], exitCodes: [], containers: [], sampleReason, advice: meta.advice, expected: meta.expected }
      groups.set(category, g)
    }
    g.count++
    if (g.taskArns.length < 20) g.taskArns.push(t.arn)
    for (const c of t.containers) {
      if (!c.reason && !c.exitCode) continue
      if (c.exitCode != null && !g.exitCodes.includes(c.exitCode)) g.exitCodes.push(c.exitCode)
      if (!g.containers.includes(c.name)) g.containers.push(c.name)
    }
  }
  const list = [...groups.values()]
  list.forEach((g) => g.exitCodes.sort((a, b) => a - b))
  list.sort((a, b) => Number(a.expected) - Number(b.expected) || b.count - a.count)
  return { total: tasks.length, groups: list, crashLoop: recent >= 3, analyzedAt: Date.now() }
}

/** The mock task stop times do not match its events. Events win, as they say when ECS stopped the task. */
function withEventTimes(tasks: Task[], events: ServiceEvent[]): Task[] {
  return tasks.map((t) => {
    const e = events.find((x) => x.createdAt != null && /stopped \d+ running tasks/.test(x.message) && x.message.includes(t.id.slice(0, 8)))
    return e ? { ...t, stoppedAt: e.createdAt } : t
  })
}

export async function handleStopped(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (cmd !== 'analyze_stopped_tasks') return undefined
  const profile = args.profile as string
  checkSession(profile)
  await delay(160)
  const svc = findService(profile, args.region as string, args.cluster as string, args.service as string)
  if (!svc) throw mockError('notFound', `Service ${String(args.service)} was not found.`)
  return analyzeTasks(withEventTimes(svc.stopped, svc.events), MOCK_T0)
}
