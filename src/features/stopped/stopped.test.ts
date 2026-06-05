import { describe, expect, it } from 'vitest'

import { analyzeTasks, classifyTask, handleStopped } from '@/lib/mock/stopped'
import type { StopGroup, StoppedAnalysis, Task } from '@/lib/types'

import { CATEGORY_META, categoryMeta, exitCodesText, groupTone, summaryMode, taskCount } from './categories'

const group = (over: Partial<StopGroup>): StopGroup => ({
  category: 'outOfMemory',
  title: 'Out of memory',
  count: 1,
  lastSeen: 0,
  taskArns: [],
  exitCodes: [],
  containers: [],
  sampleReason: '',
  advice: '',
  expected: false,
  ...over,
})

const analysis = (groups: StopGroup[]): StoppedAnalysis => ({
  total: groups.reduce((n, g) => n + g.count, 0),
  groups,
  crashLoop: false,
  analyzedAt: 0,
})

const NOW = 1_700_000_000_000

function task(id: string, stopCode: string | null, stopReason: string, exitCode: number | null, reason: string | null, ageMin: number): Task {
  return {
    arn: `arn:aws:ecs:us-east-1:1:task/c/${id}`,
    id,
    clusterName: 'c',
    serviceName: 'web',
    lastStatus: 'STOPPED',
    desiredStatus: 'STOPPED',
    healthStatus: null,
    taskDefinition: 'web:1',
    revision: 1,
    availabilityZone: null,
    privateIp: null,
    cpu: null,
    memory: null,
    startedAt: null,
    stoppedAt: NOW - ageMin * 60_000,
    stopReason,
    stopCode,
    launchType: 'FARGATE',
    enableExecuteCommand: false,
    containers: [{ name: 'app', image: null, lastStatus: 'STOPPED', healthStatus: null, exitCode, reason, runtimeId: null, execAgentStatus: null }],
  }
}

describe('categories', () => {
  it('marks only deployment, scale-in, and user stops as expected', () => {
    const expected = Object.entries(CATEGORY_META)
      .filter(([, m]) => m.expected)
      .map(([k]) => k)
    expect(expected.sort()).toEqual(['deployment', 'scaleIn', 'userStopped'])
  })

  it('falls back to other for an unknown category', () => {
    expect(categoryMeta('somethingNew').label).toBe('Other')
  })

  it('gives expected groups a neutral tone', () => {
    expect(groupTone(group({}))).toBe('crit')
    expect(groupTone(group({ category: 'capacity' }))).toBe('warn')
    expect(groupTone(group({ category: 'deployment', expected: true }))).toBe('neutral')
  })

  it('picks the summary mode', () => {
    expect(summaryMode(null)).toBe('hidden')
    expect(summaryMode(analysis([]))).toBe('hidden')
    expect(summaryMode(analysis([group({ category: 'deployment', expected: true })]))).toBe('quiet')
    expect(summaryMode(analysis([group({}), group({ category: 'scaleIn', expected: true })]))).toBe('problems')
  })

  it('formats counts and exit codes', () => {
    expect(taskCount(1)).toBe('1 task')
    expect(taskCount(3)).toBe('3 tasks')
    expect(exitCodesText([1, 137])).toBe('1, 137')
  })
})

describe('mock analysis', () => {
  it('classifies like the backend', () => {
    expect(classifyTask(task('a', 'EssentialContainerExited', 'Essential container in task exited', 137, 'OutOfMemoryError: Container killed due to memory usage', 0))).toBe('outOfMemory')
    expect(classifyTask(task('a', 'EssentialContainerExited', 'Essential container in task exited', 137, null, 0))).toBe('essentialExit')
    expect(classifyTask(task('a', 'ServiceSchedulerInitiated', 'Task failed ELB health checks in (target-group x)', null, null, 0))).toBe('healthCheck')
    expect(classifyTask(task('a', 'TaskFailedToStart', 'CannotPullContainerError: pull image manifest has been retried', null, null, 0))).toBe('imagePull')
    expect(classifyTask(task('a', 'TaskFailedToStart', 'ResourceInitializationError: unable to pull secrets or registry auth', null, null, 0))).toBe('secrets')
    expect(classifyTask(task('a', 'ServiceSchedulerInitiated', 'Scaling activity initiated by (deployment ecs-svc/1)', null, null, 0))).toBe('deployment')
    expect(classifyTask(task('a', 'ServiceSchedulerInitiated', 'Scaling activity initiated by (service web)', null, null, 0))).toBe('scaleIn')
    expect(classifyTask(task('a', 'UserInitiated', 'Task stopped by user.', 0, null, 0))).toBe('userStopped')
    expect(classifyTask(task('a', null, 'Access denied', null, null, 0))).toBe('other')
  })

  it('groups, sorts, and finds a crash loop', () => {
    const oom = (id: string, age: number) =>
      task(id, 'EssentialContainerExited', 'Essential container in task exited', 137, 'OutOfMemoryError: Container killed due to memory usage', age)
    const user = (id: string, age: number) => task(id, 'UserInitiated', 'Task stopped by user.', 0, null, age)
    const a = analyzeTasks([user('u1', 1), user('u2', 2), user('u3', 3), user('u4', 4), oom('a', 10), oom('b', 1), oom('c', 5)], NOW)
    expect(a.crashLoop).toBe(true)
    expect(a.groups.map((g) => g.category)).toEqual(['outOfMemory', 'userStopped'])
    expect(a.groups[0]).toMatchObject({ count: 3, exitCodes: [137], containers: ['app'], lastSeen: NOW - 60_000 })
    expect(a.groups[0].taskArns[0]).toMatch(/\/b$/)
    expect(analyzeTasks([oom('a', 20), oom('b', 30), oom('c', 1)], NOW).crashLoop).toBe(false)
  })

  it('shows an out-of-memory crash loop for notifications', async () => {
    const a = (await handleStopped('analyze_stopped_tasks', {
      profile: 'demo-prod',
      region: 'us-east-1',
      cluster: 'core-prod',
      service: 'notifications',
    })) as StoppedAnalysis
    expect(a.crashLoop).toBe(true)
    expect(a.groups[0]).toMatchObject({ category: 'outOfMemory', count: 3, exitCodes: [137], expected: false })
  })

  it('ignores other commands', async () => {
    expect(await handleStopped('list_tasks', {})).toBeUndefined()
  })
})
