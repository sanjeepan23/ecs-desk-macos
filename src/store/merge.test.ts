import { describe, expect, it } from 'vitest'

import type { EcsUpdate, Focus, ServiceSummary } from '@/lib/types'

import { flattenEvents, focusFor, mergeUpdate, sameFocus, type EcsData } from './merge'

const svc = (cluster: string, name: string, running = 1): ServiceSummary => ({
  arn: `arn/${cluster}/${name}`,
  name,
  clusterName: cluster,
  status: 'ACTIVE',
  desired: 2,
  running,
  pending: 0,
  taskDefinition: `td/${name}:1`,
  taskDefinitionShort: `${name}:1`,
  launchType: 'FARGATE',
  health: 'healthy',
  deployments: [],
  createdAt: null,
  enableExecuteCommand: true,
  loadBalancers: [],
})

const base: EcsData = {
  profile: 'p',
  region: 'r',
  clusters: [],
  services: [svc('core', 'api'), svc('core', 'web'), svc('data', 'etl')],
  serviceDetail: null,
  tasks: [],
}

const update = (p: Partial<EcsUpdate>): EcsUpdate => ({
  profile: 'p',
  region: 'r',
  polledAt: 5,
  clusters: null,
  services: null,
  serviceDetail: null,
  tasks: null,
  ...p,
})

const focus = (cluster: string | null, service: string | null): Focus => ({ profile: 'p', region: 'r', cluster, service })

