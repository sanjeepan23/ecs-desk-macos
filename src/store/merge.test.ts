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

describe('mergeUpdate', () => {
  it('drops updates for another profile or region', () => {
    expect(mergeUpdate(base, update({ region: 'other' }), null)).toBeNull()
  })

  it('replaces all services when the focus has no cluster', () => {
    const m = mergeUpdate(base, update({ services: [svc('data', 'etl', 2)] }), focus(null, null))
    expect(m?.services?.map((s) => s.name)).toEqual(['etl'])
    expect(m?.polledAt).toBe(5)
  })

  it('does not duplicate services when a cluster has focus', () => {
    const all = [svc('data', 'etl', 1), svc('core', 'api', 2)]
    const m = mergeUpdate(base, update({ services: all }), focus('core', null))
    expect(m?.services?.map((s) => `${s.clusterName}/${s.name}/${s.running}`)).toEqual(['core/api/2', 'data/etl/1'])
  })

  it('keeps null parts unchanged', () => {
    const m = mergeUpdate(base, update({}), focus(null, null))
    expect(m).toEqual({ polledAt: 5 })
  })

  it('accepts detail and tasks only for the focused service, and updates its summary', () => {
    const detail = { service: svc('core', 'api', 2), events: [] }
    const task = { arn: 't' } as never
    const m = mergeUpdate(base, update({ serviceDetail: detail, tasks: [task] }), focus('core', 'api'))
    expect(m?.serviceDetail).toBe(detail)
    expect(m?.tasks).toEqual([task])
    expect(m?.services?.find((s) => s.name === 'api')?.running).toBe(2)

    const other = mergeUpdate(base, update({ serviceDetail: detail, tasks: [task] }), focus(null, null))
    expect(other?.serviceDetail).toBeUndefined()
    expect(other?.tasks).toBeUndefined()
  })
})

describe('focus helpers', () => {
  it('reads cluster and service from the view', () => {
    expect(focusFor('p', 'r', { name: 'overview' })).toEqual(focus(null, null))
    expect(focusFor('p', 'r', { name: 'service', cluster: 'core', service: 'api' })).toEqual(focus('core', 'api'))
    expect(focusFor('p', 'r', { name: 'task', cluster: 'core', service: null })).toEqual(focus('core', null))
    expect(focusFor(null, 'r', { name: 'overview' })).toBeNull()
  })
  it('compares focus values', () => {
    expect(sameFocus(focus('a', null), focus('a', null))).toBe(true)
    expect(sameFocus(focus('a', null), focus('a', 'b'))).toBe(false)
    expect(sameFocus(null, null)).toBe(true)
  })
})

describe('flattenEvents', () => {
  it('splits keys and sorts newest first', () => {
    const rows = flattenEvents({
      'core/api': [{ id: '1', createdAt: 1, message: 'a' }],
      'data/etl': [{ id: '2', createdAt: 2, message: 'b' }],
    })
    expect(rows.map((r) => `${r.cluster}/${r.service}/${r.event.id}`)).toEqual(['data/etl/2', 'core/api/1'])
  })
})
