// Action dialogs (deploy, scale, rollback, stop) and the hook that opens them.

import { toast } from 'sonner'

import { api, asAppError } from '@/lib/api'
import type { Container, ServiceSummary, Task } from '@/lib/types'

import { useTerminal } from '../terminal/store'
import { ActionDialogsHost, useActionDialog } from './dialogs'
import { guard, toastError } from './guard'

export { ActionDialogsHost }

export interface ServiceActions {
  forceDeploy: (svc: ServiceSummary) => void
  scale: (svc: ServiceSummary) => void
  rollback: (svc: ServiceSummary) => void
  stopTask: (task: Task) => void
  exec: (task: Task, container?: string) => void
}

/** The app container is the one named like the service. Sidecars come last. */
export function pickContainer(task: Task): Container | null {
  const running = task.containers.filter((c) => (c.lastStatus ?? 'RUNNING') === 'RUNNING')
  const pool = running.length ? running : task.containers
  return pool.find((c) => c.name === task.serviceName) ?? pool[0] ?? null
}

/** Problems that the task data already shows, before any call to the backend. */
export function localExecProblems(task: Task, container: Container | null): string[] {
  const out: string[] = []
  if (task.lastStatus !== 'RUNNING') out.push(`The task is not running. Its status is ${task.lastStatus}.`)
  if (!task.enableExecuteCommand)
    out.push('enableExecuteCommand is false for this task. Turn it on for the service, then force a new deployment.')
  if (container && container.execAgentStatus && container.execAgentStatus !== 'RUNNING')
    out.push(`The ExecuteCommandAgent in ${container.name} is ${container.execAgentStatus}.`)
  return out
}

async function execInto(task: Task, containerName?: string) {
  const ctx = guard()
  if (!ctx) return
  const container = containerName ? (task.containers.find((c) => c.name === containerName) ?? null) : pickContainer(task)
  const name = containerName ?? container?.name
  if (!name) {
    toast.error('This task has no container to exec into.')
    return
  }
  const show = useActionDialog.getState().show
  const local = localExecProblems(task, container)
  if (local.length) {
    show({ kind: 'execProblems', task, container: name, problems: local, pluginPath: null })
    return
  }
  try {
    const check = await api.execCheck(ctx.profile, ctx.region, task.clusterName, task.arn, name)
    if (!check.ok) {
      show({ kind: 'execProblems', task, container: name, problems: check.problems, pluginPath: check.pluginPath })
      return
    }
  } catch (e) {
    toastError('Could not check exec', asAppError(e))
    return
  }
  useTerminal.getState().openExec({
    profile: ctx.profile,
    region: ctx.region,
    cluster: task.clusterName,
    taskArn: task.arn,
    service: task.serviceName,
    container: name,
  })
}

function open(fn: () => void) {
  if (guard()) fn()
}

const actions: ServiceActions = {
  forceDeploy: (svc) => open(() => useActionDialog.getState().show({ kind: 'deploy', svc })),
  scale: (svc) => open(() => useActionDialog.getState().show({ kind: 'scale', svc })),
  rollback: (svc) => open(() => useActionDialog.getState().show({ kind: 'rollback', svc })),
  stopTask: (task) => open(() => useActionDialog.getState().show({ kind: 'stop', task })),
  exec: (task, container) => void execInto(task, container),
}

export function useServiceActions(): ServiceActions {
  return actions
}
