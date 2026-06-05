// Stopped tasks grouped by cause, with advice.

import { useState } from 'react'
import { Alert02Icon, ArrowDown01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { ago, shortId, taskIdFromArn } from '@/lib/format'
import type { ServiceSummary, StopGroup, StoppedAnalysis } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Banner, ErrorState, Icon, Panel, Tag, TONE_BG, ToneBadge } from '@/views/parts/ui'

import { exitCodesText, groupTone, problemGroups, summaryMode, taskCount } from './categories'

/** ECS keeps stopped tasks for about one hour, so a 30 s refresh is enough. */
const REFRESH_MS = 30_000

function useStoppedAnalysis(svc: ServiceSummary) {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const polledAt = useApp((s) => s.polledAt)
  const tick = polledAt ? Math.floor(polledAt / REFRESH_MS) : 0
  return useAsync<StoppedAnalysis>(
    profile && region ? () => api.analyzeStoppedTasks(profile, region, svc.clusterName, svc.name) : null,
    [profile, region, svc.clusterName, svc.name, tick],
  )
}

function Stripe({ group }: { group: StopGroup }) {
  return <span className={cn('w-1 shrink-0 self-stretch rounded-full', TONE_BG[groupTone(group)])} />
}

function CrashLoopBanner() {
  return (
    <Banner tone="crit" icon={Alert02Icon}>
      <b>Crash loop.</b> <span className="text-muted-foreground">3 or more tasks stopped with a problem in the last 15 min.</span>
    </Banner>
  )
}

/** Card on the service Overview tab. Shows the top causes; renders nothing when there are no stopped tasks. */
export function StoppedSummary({ service }: { service: ServiceSummary }) {
  const navigate = useApp((s) => s.navigate)
  const res = useStoppedAnalysis(service)
  const a = res.data
  if (res.error && !a) return <ErrorState error={res.error} onRetry={res.reload} />
  const mode = summaryMode(a)
  if (!a || mode === 'hidden') return null

  const open = () => navigate({ name: 'service', cluster: service.clusterName, service: service.name, tab: 'tasks', taskState: 'STOPPED' })
  const link = (
    <Button variant="ghost" size="xs" onClick={open}>
      View stopped tasks
    </Button>
  )

  if (mode === 'quiet') {
    const labels = a.groups.map((g) => g.title.toLowerCase()).join(', ')
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
        <span>
          {taskCount(a.total)} stopped for normal reasons ({labels}).
        </span>
        {link}
      </div>
    )
  }

  const problems = problemGroups(a)
  const normal = a.groups.filter((g) => g.expected).reduce((n, g) => n + g.count, 0)
  return (
    <Panel
      title={
        <>
          Stopped tasks
          <ToneBadge tone="crit">{taskCount(problems.reduce((n, g) => n + g.count, 0))} with a problem</ToneBadge>
        </>
      }
      right={link}
    >
      {a.crashLoop && <CrashLoopBanner />}
      <ul className="space-y-3">
        {problems.slice(0, 3).map((g) => (
          <li key={g.category} className="flex gap-3">
            <Stripe group={g} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{g.title}</span>
                <span className="num text-muted-foreground">{taskCount(g.count)}</span>
                {g.exitCodes.length > 0 && <Tag>exit {exitCodesText(g.exitCodes)}</Tag>}
                <span className="ml-auto text-[12.5px] text-muted-foreground">last {ago(g.lastSeen)}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">{g.advice}</div>
            </div>
          </li>
        ))}
      </ul>
      {(problems.length > 3 || normal > 0) && (
        <div className="mt-3 text-[12.5px] text-muted-foreground">
          {problems.length > 3 && `${problems.length - 3} more causes. `}
          {normal > 0 && `${taskCount(normal)} stopped for normal reasons.`}
        </div>
      )}
    </Panel>
  )
}

