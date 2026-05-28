import { toast } from 'sonner'

import type { AppError, ServiceRef, ServiceSummary, Task, TaskRef } from '@/lib/types'
import { selectReadOnly, useApp } from '@/store/app'

export interface Ctx {
  profile: string
  region: string
}

export function currentCtx(): Ctx | null {
  const { profile, region } = useApp.getState()
  return profile && region ? { profile, region } : null
}

function goSettings() {
  useApp.getState().navigate({ name: 'settings' })
}

export function toastReadOnly(profile: string) {
  toast.warning(`${profile} is read-only.`, {
    description: 'Deploy, scale, stop, and exec are off for this profile.',
    action: { label: 'Settings', onClick: goSettings },
  })
}

/** Returns the context when actions are allowed. Otherwise it shows a toast and returns null. */
export function guard(): Ctx | null {
  const ctx = currentCtx()
  if (!ctx) {
    toast.error('Select a profile and a region first.')
    return null
  }
  if (selectReadOnly(useApp.getState())) {
    toastReadOnly(ctx.profile)
    return null
  }
  return ctx
}

/** True when the user must type the service name to confirm. */
export function needsTypedConfirm(): boolean {
  const s = useApp.getState()
  const prof = s.profiles.find((p) => p.name === s.profile)
  return !!prof?.isProd && (s.settings?.confirmProdByTyping ?? true)
}

export function toastError(title: string, err: AppError) {
  const profile = useApp.getState().profile ?? 'This profile'
  switch (err.kind) {
    case 'readOnly':
      toastReadOnly(profile)
      return
    case 'auth':
      toast.error(title, {
        description: `The AWS credentials for ${profile} are not valid or have expired. Log in again, then try again.`,
      })
      return
    case 'throttled':
      toast.error(title, { description: 'AWS throttled the request. Wait a few seconds, then try again.' })
      return
    default:
      toast.error(title, { description: err.message })
  }
}

export function serviceRef(ctx: Ctx, svc: ServiceSummary): ServiceRef {
  return { ...ctx, cluster: svc.clusterName, service: svc.name }
}

export function taskRef(ctx: Ctx, task: Task): TaskRef {
  return { ...ctx, cluster: task.clusterName, taskArn: task.arn }
}

/** Parses an ECS cpu or memory string, such as "512" or "1 vCPU" or "2 GB", to CPU units or MiB. */
export function parseUnits(v: string | number | null | undefined, kind: 'cpu' | 'memory'): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  const m = /^\s*([\d.]+)\s*([a-z]*)/i.exec(v)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2].toLowerCase()
  if (kind === 'cpu' && unit.startsWith('vcpu')) return n * 1024
  if (kind === 'memory' && unit.startsWith('gb')) return n * 1024
  return n
}

/** Text such as "2.0 vCPU · 4 GB total" for a task count. */
export function capacityText(count: number, cpuUnits: number, memMiB: number): string {
  const vcpu = (count * cpuUnits) / 1024
  const gb = (count * memMiB) / 1024
  const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))
  return `${fmt(vcpu)} vCPU · ${fmt(gb)} GB total`
}
