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

