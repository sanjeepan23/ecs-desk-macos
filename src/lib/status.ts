// Maps ECS states to UI tones and labels. Pure functions only.

import { taskDefRevision } from './format'
import type { ClusterSummary, Deployment, ServiceEvent, ServiceHealth, ServiceSummary, Task } from './types'

export type Tone = 'ok' | 'info' | 'warn' | 'crit' | 'neutral'

export const HEALTH_META: Record<ServiceHealth, { tone: Tone; label: string }> = {
  healthy: { tone: 'ok', label: 'Healthy' },
  deploying: { tone: 'info', label: 'Deploying' },
  degraded: { tone: 'warn', label: 'Degraded' },
  failing: { tone: 'crit', label: 'Failing' },
}

export function healthMeta(h: ServiceHealth | string) {
  return HEALTH_META[h as ServiceHealth] ?? { tone: 'neutral' as Tone, label: h }
}

export function taskStatusTone(status: string): Tone {
  switch (status) {
    case 'RUNNING':
      return 'ok'
    case 'PROVISIONING':
    case 'PENDING':
    case 'ACTIVATING':
      return 'info'
    case 'DEACTIVATING':
    case 'STOPPING':
    case 'DEPROVISIONING':
      return 'warn'
    case 'STOPPED':
      return 'crit'
    default:
      return 'neutral'
  }
}

export function healthCheckMeta(h: string | null | undefined): { tone: Tone; label: string } {
  if (h === 'HEALTHY') return { tone: 'ok', label: 'Healthy' }
  if (h === 'UNHEALTHY') return { tone: 'crit', label: 'Unhealthy' }
  return { tone: 'neutral', label: 'No check' }
}

export function rolloutMeta(state: string | null | undefined): { tone: Tone; label: string } {
  switch (state) {
    case 'IN_PROGRESS':
      return { tone: 'info', label: 'In progress' }
    case 'FAILED':
      return { tone: 'crit', label: 'Failed' }
    case 'ROLLED_BACK':
      return { tone: 'warn', label: 'Rolled back' }
    case 'COMPLETED':
      return { tone: 'ok', label: 'Completed' }
    default:
      return { tone: 'neutral', label: state ?? 'Unknown' }
  }
}

export function deploymentStatusLabel(status: string): string {
  if (status === 'PRIMARY') return 'Primary'
  if (status === 'ACTIVE') return 'Active'
  if (status === 'INACTIVE') return 'Inactive'
  return status
}

/** Event severity from the ECS event text. ECS events have no level field. */
export function eventTone(message: string): Tone {
  const m = message.toLowerCase()
  if (/(stopped \d+ running tasks|unable|failed|error|outofmemory|unhealthy|circuit breaker)/.test(m)) return 'crit'
  if (/(deregistered|draining|rolled back|rollback|throttl)/.test(m)) return 'warn'
  return 'neutral'
}

export function primaryDeployment(svc: ServiceSummary): Deployment | undefined {
  return svc.deployments.find((d) => d.status === 'PRIMARY') ?? svc.deployments[0]
}

/** Cluster health from its services: failing count, else deploying count, else healthy. */
export function clusterHealth(services: ServiceSummary[]): { tone: Tone; label: string } {
  const failing = services.filter((s) => s.health === 'failing' || s.health === 'degraded').length
  if (failing) return { tone: 'crit', label: `${failing} failing` }
  const deploying = services.filter((s) => s.health === 'deploying').length
  if (deploying) return { tone: 'info', label: `${deploying} deploying` }
  return { tone: 'ok', label: 'Healthy' }
}

export function clusterTotals(c: ClusterSummary, services: ServiceSummary[]) {
  const own = services.filter((s) => s.clusterName === c.name)
  if (!own.length) return { running: c.runningTasks, desired: c.runningTasks + c.pendingTasks }
  return {
    running: own.reduce((a, s) => a + s.running, 0),
    desired: own.reduce((a, s) => a + s.desired, 0),
  }
}

const RECENT_MS = 15 * 60_000

/** One-line reason that a service needs attention. Uses events when they are loaded. */
export function attentionText(svc: ServiceSummary, events: ServiceEvent[] = [], now = Date.now()): string {
  const d = primaryDeployment(svc)
  if (svc.health === 'deploying' && d) {
    return `Rollout to revision ${taskDefRevision(d.taskDefinition) ?? '?'}: ${d.running} of ${d.desired} new tasks running.`
  }
  if (svc.health === 'failing' || svc.health === 'degraded') {
    const stops = events.filter((e) => e.createdAt != null && now - e.createdAt < RECENT_MS && /stopped \d+ running tasks/i.test(e.message))
    const oom = events.some((e) => /outofmemory/i.test(e.message))
    if (stops.length && oom) return `Tasks stop with exit code 137 (OutOfMemoryError). ${stops.length} restarts in 15 min.`
    if (stops.length) return `${stops.length} tasks stopped in 15 min. ${svc.running} of ${svc.desired} running.`
    return `Below desired count: ${svc.running} of ${svc.desired} running.`
  }
  return 'Below desired count.'
}

