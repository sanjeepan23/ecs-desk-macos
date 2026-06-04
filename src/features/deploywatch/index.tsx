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

function finishToast(w: DeployWatch) {
  const m = phaseMeta(w.phase)
  const title = `${w.target.service} rollout ${m.verb}`
  const opts = {
    description: w.message ?? `${w.running} of ${w.desired} tasks running.`,
    action: { label: 'View', onClick: () => void openWatch(w) },
    duration: 10_000,
  }
  if (w.phase === 'completed') toast.success(title, opts)
  else if (w.phase === 'failed') toast.error(title, opts)
  else if (w.phase !== 'cancelled') toast.warning(title, opts)
}

/** Mount once near the app root. Subscribes to `deploy://watch` and shows toasts. */
export function DeployWatchHost() {
  useEffect(() => {
    let live = true
    const un = events.onDeployWatch((w) => {
      const { watches, upsert } = useWatches.getState()
      if (justFinished(watches, w)) finishToast(w)
      upsert(w)
    })
    api
      .listWatches()
      .then((list) => live && list.forEach(useWatches.getState().upsert))
      .catch(() => {})
    return () => {
      live = false
      void un.then((f) => f())
    }
  }, [])
  return null
}

function Spinner({ className }: { className?: string }) {
  return <Icon icon={Loading03Icon} size={13} className={cn('animate-spin', className)} />
}

function Counts({ w }: { w: DeployWatch }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
      <span className="num">
        <b className="text-foreground">{w.running}</b>
        <span className="text-muted-foreground"> of {w.desired} running</span>
      </span>
      <span className={cn('num', w.pending > 0 ? 'text-info' : 'text-muted-foreground')}>{w.pending} pending</span>
      <span className={cn('num', w.failed > 0 ? 'text-crit' : 'text-muted-foreground')}>{w.failed} failed</span>
    </div>
  )
}

function WatchCard({ w }: { w: DeployWatch }) {
  const now = useNow(1000)
  const hide = useWatches((s) => s.hide)
  const m = phaseMeta(w.phase)
  const running = isRunning(w)

  const stop = () => {
    api.unwatch(w.id).catch((e) => toastError('Could not stop the watch', asAppError(e)))
  }

  return (
    <Panel
      className="mb-4"
      title={
        <>
          {running && <Spinner className="text-info" />}
          Rollout
          <ToneBadge tone={m.tone}>{m.label}</ToneBadge>
          <Tag>{taskDefShort(w.taskDefinition)}</Tag>
        </>
      }
      right={
        <>
          <span className="num text-xs text-muted-foreground">{elapsedText(watchElapsed(w, now))}</span>
          {running ? (
            <Button size="xs" variant="outline" onClick={stop}>
              Stop watching
            </Button>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => hide(w.id)}>
              Hide
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <UsageBar className="min-w-40 flex-1" value={progressPct(w)} tone={running ? 'info' : m.tone} />
          <Counts w={w} />
        </div>
        {w.message && <p className={cn('text-[12.5px]', w.phase === 'completed' ? 'text-muted-foreground' : TONE_TEXT[m.tone])}>{w.message}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">New events</div>
            {w.events.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No new events yet.</p>
            ) : (
              <ol className="grid max-h-56 gap-1.5 overflow-y-auto pr-1">
                {w.events.map((e) => (
                  <li key={e.id} className="flex gap-2 text-[12.5px]">
                    <StatusDot tone={eventTone(e.message)} className="mt-1.5" />
                    <span className="num shrink-0 text-muted-foreground">{hms(e.createdAt)}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">{e.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Stopped tasks of this deployment</div>
            {w.failedTasks.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No task of this deployment stopped.</p>
            ) : (
              <ul className="grid max-h-56 gap-1.5 overflow-y-auto pr-1">
                {w.failedTasks.map((t) => (
                  <li key={t.arn} className="flex gap-2 text-[12.5px]">
                    <button
                      type="button"
                      className="shrink-0 font-mono text-xs text-info hover:underline"
                      onClick={() => void openTask(w, t)}
                      title="Open the task"
                    >
                      {shortId(t.id || t.arn.split('/').pop() || t.arn)}
                    </button>
                    <span className="num shrink-0 text-muted-foreground">{hms(t.stoppedAt)}</span>
                    <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{t.stopReason ?? t.stopCode ?? 'No stop reason.'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Panel>
  )
}

/** Live rollout timeline at the top of the service Deployments tab. */
export function DeployTimeline({ service }: { service: ServiceSummary }) {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const target = profile && region ? { profile, region, cluster: service.clusterName, service: service.name } : null
  const id = target ? watchId(target) : null
  const watch = useWatches((s) => (id ? s.watches.find((w) => w.id === id) : undefined))

  if (!target) return null
  if (watch) return <WatchCard w={watch} />
  if (primaryDeployment(service)?.rolloutState !== 'IN_PROGRESS') return null
  return (
    <div className="mb-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
      A rollout is in progress.
      <Button size="xs" variant="outline" onClick={() => watchService(target)}>
        <Icon icon={ViewIcon} size={13} />
        Watch rollout
      </Button>
    </div>
  )
}

/** Status bar item with the count of running watches and a popover list. */
export function RolloutsIndicator() {
  const watches = useWatches((s) => s.watches)
  const now = useNow(1000)
  if (watches.length === 0) return null
  const active = watches.filter(isRunning).length
  const btn = 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={btn} aria-label={`Rollouts: ${active} running, ${watches.length} in total`}>
          {active > 0 ? <Spinner className="text-info" /> : <StatusDot tone={phaseMeta(watches[0].phase).tone} />}
          Rollouts <span className="num">{active > 0 ? active : watches.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80 gap-2 p-2">
        <div className="px-2 pt-1 text-xs font-medium text-muted-foreground">
          {active > 0 ? `${active} running` : 'No rollout is running'} · finished rollouts stay for 30 min
        </div>
        <ul className="grid gap-0.5">
          {watches.map((w) => {
            const m = phaseMeta(w.phase)
            return (
              <li key={w.id}>
                <button
                  type="button"
                  className="grid w-full gap-1 rounded-xl px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => void openWatch(w)}
                >
                  <span className="flex items-center gap-2">
                    {isRunning(w) ? <Spinner className="text-info" /> : <StatusDot tone={m.tone} />}
                    <span className="min-w-0 flex-1 truncate font-medium">{w.target.service}</span>
                    <span className={cn('text-xs', TONE_TEXT[m.tone])}>{m.label}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <UsageBar className="w-20 min-w-0" value={progressPct(w)} tone={isRunning(w) ? 'info' : m.tone} />
                    <span className="num">
                      {w.running}/{w.desired}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {w.target.profile} · {w.target.cluster}
                    </span>
                    <span className="num">{elapsedText(watchElapsed(w, now))}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
