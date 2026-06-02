// Follows rollouts to the end and shows their progress.

import { useEffect } from 'react'
import { toast } from 'sonner'
import { Loading03Icon, ViewIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNow } from '@/hooks/useNow'
import { api, asAppError, events } from '@/lib/api'
import { hms, shortId, taskDefShort } from '@/lib/format'
import { eventTone, primaryDeployment } from '@/lib/status'
import type { DeployWatch, ServiceRef, ServiceSummary, Task } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Icon, Panel, StatusDot, Tag, TONE_TEXT, ToneBadge, UsageBar } from '@/views/parts/ui'

import { toastError } from '../actions/guard'
import { elapsedText, isRunning, justFinished, phaseMeta, progressPct, watchElapsed, watchId } from './model'
import { useWatches } from './store'

/** Switches to the profile and region of the target when they differ. */
async function enterScope(t: ServiceRef) {
  const app = useApp.getState()
  if (app.profile !== t.profile) await app.setProfile(t.profile)
  if (useApp.getState().region !== t.region) await useApp.getState().setRegion(t.region)
}

async function openWatch(w: DeployWatch) {
  await enterScope(w.target)
  useApp.getState().navigate({ name: 'service', cluster: w.target.cluster, service: w.target.service, tab: 'deployments' })
}

async function openTask(w: DeployWatch, t: Task) {
  await enterScope(w.target)
  useApp.getState().navigate({ name: 'task', cluster: w.target.cluster, service: w.target.service, taskArn: t.arn })
}

/** Starts a watch for the service. Action dialogs call this after deploy, rollback, and scale. */
export function watchService(target: ServiceRef): void {
  api
    .watchDeployment(target)
    .then((w) => useWatches.getState().upsert(w))
    .catch((e) => toastError(`Could not watch the rollout of ${target.service}`, asAppError(e)))
}

