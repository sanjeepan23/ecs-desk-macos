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

function moveToStopped(svc: MockService, task: Task) {
  svc.tasks = svc.tasks.filter((t) => t !== task)
  svc.stopped.unshift(task)
  svc.stopped = svc.stopped.slice(0, 20)
}

/* ---------- Deployments ---------- */

const rollouts = new Map<string, ReturnType<typeof setInterval>>()

function digits(r: () => number, n: number) {
  return Array.from({ length: n }, () => Math.floor(r() * 10)).join('')
}

/** Starts a new PRIMARY deployment and replaces one task every 1.6 s, like ECS does. */
function startRollout(svc: MockService, rev: number, reason: string) {
  const s = svc.summary
  const now = Date.now()
  const r = rng(s.arn + now)
  const td = `arn:aws:ecs:${svc.region}:${accountOf(svc.profile)}:task-definition/${s.name}:${rev}`
  const old = s.deployments.find((d) => d.status === 'PRIMARY')
  if (old) {
    old.status = 'ACTIVE'
    if (old.rolloutState === 'IN_PROGRESS') old.rolloutState = 'FAILED'
  }
  const d: Deployment = {
    id: `ecs-svc/${digits(r, 19)}`,
    status: 'PRIMARY',
    taskDefinition: td,
    desired: s.desired,
    running: 0,
    pending: Math.min(2, s.desired),
    failed: 0,
    rolloutState: 'IN_PROGRESS',
    rolloutReason: null,
    createdAt: now,
    updatedAt: now,
  }
  s.deployments = old ? [d, old] : [d]
  s.taskDefinition = td
  s.taskDefinitionShort = `${s.name}:${rev}`
  s.health = 'deploying'
  addEvent(svc, `(service ${s.name}) ${reason}`)

  const prev = rollouts.get(s.arn)
  if (prev) clearInterval(prev)
  const oldArns = new Set(svc.tasks.map((t) => t.arn))
  const isOld = (t: Task) => oldArns.has(t.arn)

  const step = () => {
    if (d.running < d.desired) {
      const nt = makeTask(svc, r, { rev, startedAt: Date.now() })
      svc.tasks.unshift(nt)
      d.running++
      d.pending = Math.max(0, Math.min(2, d.desired - d.running))
      d.updatedAt = Date.now()
      addEvent(svc, `(service ${s.name}) has started 1 tasks: (task ${nt.id.slice(0, 8)}).`)
      const oldTask = [...svc.tasks].reverse().find(isOld)
      if (oldTask) {
        markStopped(oldTask, `Scaling activity initiated by (deployment ${d.id})`, 'ServiceSchedulerInitiated')
        moveToStopped(svc, oldTask)
        if (old) old.running = Math.max(0, old.running - 1)
      }
    }
    if (d.running >= d.desired) {
      clearInterval(rollouts.get(s.arn))
      rollouts.delete(s.arn)
      for (const t of svc.tasks.filter(isOld)) {
        markStopped(t, `Scaling activity initiated by (deployment ${d.id})`, 'ServiceSchedulerInitiated')
        moveToStopped(svc, t)
      }
      d.rolloutState = 'COMPLETED'
      d.rolloutReason = 'ECS deployment completed.'
      d.pending = 0
      s.deployments = [d]
      s.health = 'healthy'
      addEvent(svc, `(service ${s.name}) has reached a steady state.`)
    }
    recompute(svc)
    emitNow()
  }
  rollouts.set(s.arn, setInterval(step, 1600))
  emitNow()
}

