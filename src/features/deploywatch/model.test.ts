import { describe, expect, it } from 'vitest'

import type { DeployWatch } from '@/lib/types'

import { elapsedText, justFinished, mergeWatch, phaseMeta, progressPct, sortWatches, watchElapsed, watchId } from './model'

const target = { profile: 'dev', region: 'us-east-1', cluster: 'core', service: 'web' }

function w(over: Partial<DeployWatch> = {}): DeployWatch {
  return {
    id: watchId(target),
    target,
    deploymentId: 'ecs-svc/1',
    taskDefinition: 'arn:aws:ecs:us-east-1:1:task-definition/web:7',
    phase: 'inProgress',
    desired: 4,
    running: 1,
    pending: 2,
    failed: 0,
    startedAt: 1000,
    updatedAt: 1000,
    finishedAt: null,
    events: [],
    failedTasks: [],
    message: null,
    ...over,
  }
}

describe('phaseMeta', () => {
  it('gives a label and tone for each phase', () => {
    expect(phaseMeta('inProgress')).toMatchObject({ label: 'In progress', tone: 'info' })
    expect(phaseMeta('completed').tone).toBe('ok')
    expect(phaseMeta('failed').tone).toBe('crit')
    expect(phaseMeta('rolledBack').label).toBe('Rolled back')
    expect(phaseMeta('timedOut').tone).toBe('warn')
    expect(phaseMeta('cancelled').tone).toBe('neutral')
  })
})

describe('elapsedText', () => {
  it('formats seconds, minutes, and hours', () => {
    expect(elapsedText(-5)).toBe('0 s')
    expect(elapsedText(45_000)).toBe('45 s')
    expect(elapsedText(185_000)).toBe('3 min 05 s')
    expect(elapsedText(3_720_000)).toBe('1 h 02 min')
  })

  it('stops the clock when the watch finishes', () => {
    expect(watchElapsed(w({ finishedAt: 61_000 }), 999_999)).toBe(60_000)
    expect(watchElapsed(w(), 11_000)).toBe(10_000)
  })
})

