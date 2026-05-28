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

