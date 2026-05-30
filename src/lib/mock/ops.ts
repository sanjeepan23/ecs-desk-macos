// Mock handlers for actions, logs, metrics, and exec.
// Return undefined for a command this file does not handle, and null for a void command.

import type { Deployment, ExecCheck, ExecStart, LogLine, LogTarget, MetricPoint, ServiceMetrics, ServiceRef, Task, TaskRef } from '../types'
import { EVENTS } from '../types'
import { delay, emit } from './bus'
import {
  accountOf,
  addEvent,
  checkSession,
  emitNow,
  findService,
  findTask,
  hex,
  isReadOnly,
  makeTask,
  mockError,
  recompute,
  rng,
  taskDefinitionJson,
  world,
  type MockService,
} from './data'

type Args = Record<string, unknown>

const clone = <T>(v: T): T => structuredClone(v)

function guardWrite(profile: string) {
  checkSession(profile)
  if (isReadOnly(profile)) throw mockError('readOnly', `${profile} is read-only. Turn off read-only mode in Settings to run actions.`)
}

function requireService(t: ServiceRef): MockService {
  const svc = findService(t.profile, t.region, t.cluster, t.service)
  if (!svc) throw mockError('notFound', `Service ${t.service} was not found in ${t.cluster}.`)
  return svc
}

const isFailing = (svc: MockService | undefined, name: string) => (svc ? svc.summary.health === 'failing' : name === 'notifications')

/* ---------- Task state changes ---------- */

function markStopped(task: Task, reason: string, code = 'UserInitiated') {
  const now = Date.now()
  task.lastStatus = 'STOPPED'
  task.desiredStatus = 'STOPPED'
  task.stoppedAt = now
  task.stopReason = reason
  task.stopCode = code
  task.healthStatus = 'UNKNOWN'
  for (const c of task.containers) {
    c.lastStatus = 'STOPPED'
    c.exitCode = 0
    c.execAgentStatus = null
  }
}

