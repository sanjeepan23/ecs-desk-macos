import { describe, expect, it } from 'vitest'

import { attentionText, clusterHealth, connectionMeta, eventTone, healthCheckMeta, healthMeta, rolloutMeta, taskStatusTone } from './status'
import type { Deployment, ServiceSummary } from './types'

function svc(p: Partial<ServiceSummary>): ServiceSummary {
  return {
    arn: 'arn',
    name: 'svc',
    clusterName: 'core',
    status: 'ACTIVE',
    desired: 2,
    running: 2,
    pending: 0,
    taskDefinition: 'arn:aws:ecs:r:1:task-definition/svc:3',
    taskDefinitionShort: 'svc:3',
    launchType: 'FARGATE',
    health: 'healthy',
    deployments: [],
    createdAt: null,
    enableExecuteCommand: true,
    loadBalancers: [],
    ...p,
  }
}

const dep = (p: Partial<Deployment>): Deployment => ({
  id: 'd',
  status: 'PRIMARY',
  taskDefinition: 'arn:aws:ecs:r:1:task-definition/svc:58',
  desired: 4,
  running: 1,
  pending: 1,
  failed: 0,
  rolloutState: 'IN_PROGRESS',
  rolloutReason: null,
  createdAt: null,
  updatedAt: null,
  ...p,
})

describe('tones and labels', () => {
  it('maps service health', () => {
    expect(healthMeta('failing')).toEqual({ tone: 'crit', label: 'Failing' })
    expect(healthMeta('deploying').tone).toBe('info')
    expect(healthMeta('other').tone).toBe('neutral')
  })
  it('maps task status, health checks, and rollouts', () => {
    expect(taskStatusTone('RUNNING')).toBe('ok')
    expect(taskStatusTone('PROVISIONING')).toBe('info')
    expect(taskStatusTone('STOPPED')).toBe('crit')
    expect(healthCheckMeta('UNKNOWN').label).toBe('No check')
    expect(rolloutMeta('IN_PROGRESS').label).toBe('In progress')
    expect(rolloutMeta(null).tone).toBe('neutral')
  })
  it('reads event severity from the text', () => {
    expect(eventTone('(service x) stopped 1 running tasks: (task a). Reason: OutOfMemoryError.')).toBe('crit')
    expect(eventTone('(service x) has reached a steady state.')).toBe('neutral')
  })
})

describe('clusterHealth', () => {
  it('counts failing first, then deploying', () => {
    expect(clusterHealth([svc({ health: 'failing' }), svc({ health: 'deploying' })])).toEqual({ tone: 'crit', label: '1 failing' })
    expect(clusterHealth([svc({ health: 'deploying' })]).label).toBe('1 deploying')
    expect(clusterHealth([svc({})]).label).toBe('Healthy')
  })
})

describe('attentionText', () => {
  const now = 10_000_000
  it('describes a rollout', () => {
    expect(attentionText(svc({ health: 'deploying', deployments: [dep({})] }))).toBe('Rollout to revision 58: 1 of 4 new tasks running.')
  })
  it('describes OOM restarts from recent events', () => {
    const events = [1, 2, 3].map((i) => ({
      id: String(i),
      createdAt: now - i * 60_000,
      message: '(service n) stopped 1 running tasks: (task a). Reason: OutOfMemoryError.',
    }))
    expect(attentionText(svc({ health: 'failing', running: 1 }), events, now)).toBe(
      'Tasks stop with exit code 137 (OutOfMemoryError). 3 restarts in 15 min.',
    )
  })
  it('falls back to counts without events', () => {
    expect(attentionText(svc({ health: 'failing', running: 1 }))).toBe('Below desired count: 1 of 2 running.')
  })
})

describe('connectionMeta', () => {
  const ok = { polledAt: 1, throttled: false, lastError: null }
  it('orders states by importance', () => {
    expect(connectionMeta(ok, false).label).toBe('Connected')
    expect(connectionMeta({ ...ok, throttled: true }, false).label).toBe('Throttled')
    expect(connectionMeta({ ...ok, lastError: 'x' }, false).label).toBe('Poll error')
    expect(connectionMeta({ ...ok, throttled: true }, true).label).toBe('Session expired')
    expect(connectionMeta(null, false).label).toBe('Connecting')
  })
})
