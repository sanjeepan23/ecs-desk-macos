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

