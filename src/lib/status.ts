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

