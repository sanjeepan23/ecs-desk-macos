// Pure merge of poller updates into store data. Tests call these functions directly.

import type { ClusterSummary, EcsUpdate, Focus, ServiceDetail, ServiceEvent, ServiceSummary, Task } from '@/lib/types'

export interface EcsData {
  profile: string | null
  region: string | null
  clusters: ClusterSummary[]
  services: ServiceSummary[]
  serviceDetail: ServiceDetail | null
  tasks: Task[]
}

export type Merged = Partial<Pick<EcsData, 'clusters' | 'services' | 'serviceDetail' | 'tasks'>> & { polledAt: number }

const byClusterThenName = (a: ServiceSummary, b: ServiceSummary) =>
  a.clusterName.localeCompare(b.clusterName) || a.name.localeCompare(b.name)

/**
 * Returns the store fields to change, or null when the update is for another profile or region.
 * Services in the update cover every cluster in the profile and region.
 */
export function mergeUpdate(s: EcsData, u: EcsUpdate, focus: Focus | null): Merged | null {
  if (u.profile !== s.profile || u.region !== s.region) return null
  const out: Merged = { polledAt: u.polledAt }
  if (u.clusters) out.clusters = u.clusters

  let services = s.services
  if (u.services) services = [...u.services].sort(byClusterThenName)

  const d = u.serviceDetail
  if (d && focus?.service === d.service.name && focus.cluster === d.service.clusterName) {
    out.serviceDetail = d
    services = replaceService(services, d.service)
  }
  if (services !== s.services) out.services = services

  if (u.tasks && focus?.service) out.tasks = u.tasks
  return out
}

/** Replaces one service by ARN and keeps the list order. Adds it when it is new. */
export function replaceService(list: ServiceSummary[], svc: ServiceSummary): ServiceSummary[] {
  const i = list.findIndex((x) => x.arn === svc.arn)
  if (i < 0) return [...list, svc].sort(byClusterThenName)
  const next = list.slice()
  next[i] = svc
  return next
}

