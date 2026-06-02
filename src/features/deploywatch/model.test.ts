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

describe('mergeWatch', () => {
  it('adds and replaces by id', () => {
    const one = mergeWatch([], w())
    expect(one).toHaveLength(1)
    const two = mergeWatch(one, w({ running: 3, updatedAt: 2000 }))
    expect(two).toHaveLength(1)
    expect(two[0].running).toBe(3)
  })

  it('ignores older updates and does not reopen a finished run', () => {
    const list = [w({ phase: 'completed', updatedAt: 5000, finishedAt: 5000 })]
    expect(mergeWatch(list, w({ updatedAt: 4000 }))).toBe(list)
    expect(mergeWatch(list, w({ updatedAt: 6000 }))).toBe(list)
    // A new run of the same service replaces the finished one.
    expect(mergeWatch(list, w({ startedAt: 9000, updatedAt: 9000 }))[0].startedAt).toBe(9000)
  })

  it('removes a cancelled watch', () => {
    const list = [w()]
    expect(mergeWatch(list, w({ phase: 'cancelled', updatedAt: 2000 }))).toEqual([])
    expect(mergeWatch([], w({ phase: 'cancelled' }))).toEqual([])
  })

  it('puts running watches first, then newest', () => {
    const a = w({ id: 'a', phase: 'completed', startedAt: 3000 })
    const b = w({ id: 'b', startedAt: 1000 })
    const c = w({ id: 'c', phase: 'failed', startedAt: 2000 })
    expect(sortWatches([a, b, c]).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('justFinished', () => {
  it('is true only on the change from running to final', () => {
    const list = [w()]
    expect(justFinished(list, w({ phase: 'failed' }))).toBe(true)
    expect(justFinished(list, w({ running: 2 }))).toBe(false)
    expect(justFinished([], w({ phase: 'failed' }))).toBe(false)
    expect(justFinished([w({ phase: 'completed' })], w({ phase: 'completed' }))).toBe(false)
  })
})

describe('progressPct', () => {
  it('handles zero desired', () => {
    expect(progressPct({ running: 1, desired: 4 })).toBe(25)
    expect(progressPct({ running: 6, desired: 4 })).toBe(100)
    expect(progressPct({ running: 0, desired: 0 })).toBe(100)
  })
})
