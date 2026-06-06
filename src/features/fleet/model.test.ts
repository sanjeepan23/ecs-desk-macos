import { describe, expect, it } from 'vitest'

import type { FleetEntry, Profile, ServiceHealth, ServiceSummary } from '@/lib/types'

import { allHealthy, groupByProfile, mergeEntries, sortAttention, summarize, upsertEntry } from './model'

function svc(name: string, health: ServiceHealth, clusterName = 'core'): ServiceSummary {
  return {
    arn: `arn/${clusterName}/${name}`,
    name,
    clusterName,
    status: 'ACTIVE',
    desired: 2,
    running: 1,
    pending: 0,
    taskDefinition: '',
    taskDefinitionShort: '',
    launchType: null,
    health,
    deployments: [],
    createdAt: null,
    enableExecuteCommand: false,
    loadBalancers: [],
  }
}

function entry(profile: string, region: string, p: Partial<FleetEntry> = {}): FleetEntry {
  return {
    profile,
    region,
    status: 'ok',
    message: null,
    isProd: false,
    clusters: 1,
    services: 2,
    runningTasks: 2,
    desiredTasks: 2,
    attention: [],
    scannedAt: 1,
    ...p,
  }
}

function profile(name: string, regions: string[], p: Partial<Profile> = {}): Profile {
  return { name, accountId: '123412341234', region: regions[0], regions, authKind: 'sso', isProd: false, readOnly: false, ...p }
}

describe('upsertEntry', () => {
  it('replaces by profile and region', () => {
    const list = [entry('a', 'r1', { status: 'pending' }), entry('a', 'r2')]
    const next = upsertEntry(list, entry('a', 'r1', { status: 'ok' }))
    expect(next).toHaveLength(2)
    expect(next[0].status).toBe('ok')
    expect(list[0].status).toBe('pending')
    expect(upsertEntry(list, entry('b', 'r1'))).toHaveLength(3)
  })

  it('merges a batch', () => {
    const next = mergeEntries([entry('a', 'r1')], [entry('a', 'r1', { status: 'pending' }), entry('b', 'r1')])
    expect(next.map((e) => `${e.profile}/${e.status}`)).toEqual(['a/pending', 'b/ok'])
  })
})

describe('groupByProfile', () => {
  it('puts profiles with failing services first and keeps region order', () => {
    const profiles = [profile('a', ['us-west-2', 'us-east-1']), profile('b', ['eu-west-1'], { isProd: true })]
    const groups = groupByProfile(
      [entry('a', 'us-east-1'), entry('a', 'us-west-2'), entry('b', 'eu-west-1', { attention: [svc('x', 'failing')] })],
      profiles,
    )
    expect(groups.map((g) => g.profile)).toEqual(['b', 'a'])
    expect(groups[0].isProd).toBe(true)
    expect(groups[1].entries.map((e) => e.region)).toEqual(['us-west-2', 'us-east-1'])
    expect(groups[1].accountId).toBe('123412341234')
  })

  it('ranks auth errors above healthy profiles', () => {
    const groups = groupByProfile([entry('a', 'r'), entry('b', 'r', { status: 'auth' })], [])
    expect(groups.map((g) => g.profile)).toEqual(['b', 'a'])
  })
})

describe('summarize', () => {
  it('counts scanned profiles, attention, failing, and auth errors', () => {
    const s = summarize([
      entry('a', 'r1', { attention: [svc('x', 'failing'), svc('y', 'deploying'), svc('z', 'degraded')] }),
      entry('a', 'r2', { status: 'scanning' }),
      entry('b', 'r1', { status: 'auth' }),
      entry('c', 'r1'),
    ])
    expect(s).toEqual({ profilesScanned: 2, profilesTotal: 3, attention: 3, failing: 2, authProfiles: 1, scanning: true })
  })
})

describe('allHealthy', () => {
  it('is true only when every scan is ok and clean', () => {
    expect(allHealthy([])).toBe(false)
    expect(allHealthy([entry('a', 'r')])).toBe(true)
    expect(allHealthy([entry('a', 'r', { status: 'error' })])).toBe(false)
    expect(allHealthy([entry('a', 'r', { attention: [svc('x', 'deploying')] })])).toBe(false)
  })
})

describe('sortAttention', () => {
  it('sorts failing, degraded, deploying', () => {
    const list = [svc('a', 'deploying'), svc('b', 'degraded'), svc('c', 'failing'), svc('d', 'failing', 'aaa')]
    expect(sortAttention(list).map((s) => s.name)).toEqual(['d', 'c', 'b', 'a'])
  })
})
