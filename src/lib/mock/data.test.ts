import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClusterSummary, EcsUpdate, ServiceSummary, Task } from '../types'
import { EVENTS } from '../types'
import { on } from './bus'
import { handleData, mockControls } from './data'

const call = <T>(cmd: string, args: Record<string, unknown> = {}) => handleData(cmd, args) as Promise<T>

describe('mock world', () => {
  it('matches the UI mock example data', async () => {
    const clusters = await call<ClusterSummary[]>('list_clusters', { profile: 'demo-prod', region: 'us-east-1' })
    expect(clusters.map((c) => c.name)).toEqual(['core-prod', 'data-prod'])
    const services = await call<ServiceSummary[]>('list_services', { profile: 'demo-prod', region: 'us-east-1', cluster: 'core-prod' })
    expect(services.find((s) => s.name === 'payments-worker')?.health).toBe('deploying')
    expect(services.find((s) => s.name === 'notifications')?.health).toBe('failing')
    const eu = await call<ClusterSummary[]>('list_clusters', { profile: 'demo-prod', region: 'eu-west-1' })
    expect(eu.map((c) => c.name)).toEqual(['core-prod-eu'])
  })

  it('returns OOM stopped tasks for notifications', async () => {
    const tasks = await call<Task[]>('list_tasks', {
      profile: 'demo-prod',
      region: 'us-east-1',
      cluster: 'core-prod',
      service: 'notifications',
      desiredStatus: 'STOPPED',
    })
    expect(tasks).toHaveLength(3)
    expect(tasks[0].containers[0].exitCode).toBe(137)
  })

  it('returns undefined for commands it does not own', async () => {
    expect(await handleData('force_deploy', {})).toBeUndefined()
    expect(await handleData('set_focus', { focus: { profile: 'demo-dev', region: 'us-east-1', cluster: null, service: null } })).toBeNull()
  })

  it('throws an auth error after the session expires, until login', async () => {
    mockControls.expireSession('demo-staging')
    await expect(call('list_clusters', { profile: 'demo-staging', region: 'us-east-1' })).rejects.toMatchObject({ kind: 'auth' })
    await call('sso_login', { profile: 'demo-staging' })
    await expect(call('list_clusters', { profile: 'demo-staging', region: 'us-east-1' })).resolves.toHaveLength(2)
  })
})

describe('mock poller', () => {
  afterEach(() => vi.useRealTimers())

  it('emits updates for the focus', async () => {
    vi.useFakeTimers()
    const updates: EcsUpdate[] = []
    const off = on(EVENTS.ecsUpdate, (u) => updates.push(u as EcsUpdate))
    await handleData('set_focus', { focus: { profile: 'demo-prod', region: 'us-east-1', cluster: 'core-prod', service: 'notifications' } })
    await vi.advanceTimersByTimeAsync(3100)
    off()
    expect(updates.length).toBeGreaterThanOrEqual(2)
    const u = updates.at(-1)!
    expect(new Set(u.services?.map((s) => s.clusterName))).toEqual(new Set(['core-prod', 'data-prod']))
    expect(u.serviceDetail?.service.name).toBe('notifications')
    expect(u.tasks).toHaveLength(2)
  })
})
