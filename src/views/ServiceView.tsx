import { useMemo, useState } from 'react'
import { ArrowExpandIcon, Rocket01Icon, Undo02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useServiceActions } from '@/features/actions'
import { DeployTimeline } from '@/features/deploywatch'
import { LogsPanel } from '@/features/logs'
import { MetricsPanel, MetricsSummary } from '@/features/metrics'
import { StoppedGroups, StoppedSummary } from '@/features/stopped'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { ago, dateTime, pct, taskDefFamily, taskDefShort } from '@/lib/format'
import { deploymentStatusLabel, healthMeta, primaryDeployment, rolloutMeta } from '@/lib/status'
import type { ServiceSummary, Task } from '@/lib/types'
import { useApp, type ServiceTab } from '@/store/app'

import { DataTable, type Column } from './parts/DataTable'
import { JsonView } from './parts/JsonView'
import { EventsTable, ServiceMenu, TaskTable } from './parts/tables'
import {
  ActionButton,
  CopyButton,
  EmptyState,
  ErrorState,
  HealthBadge,
  KV,
  PageHeader,
  Panel,
  ReadOnlyBanner,
  ScopeCrumbs,
  SectionTitle,
  Segmented,
  Tag,
  ToneBadge,
  Toolbar,
  UsageBar,
} from './parts/ui'

const TABS: [ServiceTab, string][] = [
  ['overview', 'Overview'],
  ['tasks', 'Tasks'],
  ['deployments', 'Deployments'],
  ['events', 'Events'],
  ['logs', 'Logs'],
  ['metrics', 'Metrics'],
  ['config', 'Task definition'],
]

/** Target group name from a target group ARN. */
function targetGroupName(arn: string): string {
  const m = arn.match(/targetgroup\/([^/]+)/)
  return m ? m[1] : arn
}

export function ServiceView({
  cluster,
  service,
  tab = 'overview',
  taskState = 'RUNNING',
}: {
  cluster: string
  service: string
  tab?: ServiceTab
  taskState?: 'RUNNING' | 'STOPPED'
}) {
  const detail = useApp((s) => s.serviceDetail)
  const fromList = useApp((s) => s.services.find((x) => x.clusterName === cluster && x.name === service))
  const loading = useApp((s) => s.loadingScope)
  const tasks = useApp((s) => s.tasks)
  const navigate = useApp((s) => s.navigate)
  const actions = useServiceActions()

  const own = detail && detail.service.clusterName === cluster && detail.service.name === service ? detail : null
  const svc = own?.service ?? fromList
  const crumbs = [{ label: cluster, onClick: () => navigate({ name: 'cluster', cluster }) }, { label: service }]

  if (!svc) {
    return (
      <>
        <ScopeCrumbs items={crumbs} />
        <PageHeader title={service} />
        {loading ? (
          <Skeleton className="h-60 rounded-2xl" />
        ) : (
          <ErrorState error={{ kind: 'notFound', message: `Service ${service} is not in cluster ${cluster}.` }} />
        )}
      </>
    )
  }

  const counts: Partial<Record<ServiceTab, number>> = {
    tasks: tasks.length,
    deployments: svc.deployments.length,
    events: own?.events.length,
  }

  return (
    <>
      <ScopeCrumbs items={crumbs} />
      <PageHeader
        title={svc.name}
        sub={
          <>
            <HealthBadge health={svc.health} />
            <span className="num">
              {svc.running} running · {svc.desired} desired · {svc.pending} pending
            </span>
            <Tag>{svc.taskDefinitionShort}</Tag>
            {svc.launchType && <Tag>{svc.launchType}</Tag>}
          </>
        }
        actions={
          <>
            <ActionButton icon={ArrowExpandIcon} onClick={() => actions.scale(svc)}>
              Scale
            </ActionButton>
            <ActionButton icon={Rocket01Icon} variant="default" onClick={() => actions.forceDeploy(svc)}>
              Force new deployment
            </ActionButton>
            <ServiceMenu svc={svc} trigger="button" />
          </>
        }
      />
      <ReadOnlyBanner />
      <Tabs value={tab} onValueChange={(t) => navigate({ name: 'service', cluster, service, tab: t as ServiceTab })} className="gap-0">
        <div className="mb-[18px] overflow-x-auto border-b">
          <TabsList variant="line" className="h-auto gap-0.5 p-0">
            {TABS.map(([k, label]) => (
              <TabsTrigger key={k} value={k} className="h-9 flex-none rounded-none px-3 after:bottom-[-1px]">
                {label}
                {counts[k] != null && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{counts[k]}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab svc={svc} events={own?.events} />
        </TabsContent>
        <TabsContent value="tasks">
          <TasksTab key={taskState} svc={svc} active={tasks} initialState={taskState} />
        </TabsContent>
        <TabsContent value="deployments">
          <DeploymentsTab svc={svc} />
        </TabsContent>
        <TabsContent value="events">
          {own ? (
            <EventsTable rows={own.events.map((event) => ({ event, cluster, service }))} />
          ) : (
            <Skeleton className="h-60 rounded-2xl" />
          )}
        </TabsContent>
        <TabsContent value="logs">
          <ServiceLogs svc={svc} />
        </TabsContent>
        <TabsContent value="metrics">
          <MetricsPanel service={svc} />
        </TabsContent>
        <TabsContent value="config">
          <ConfigTab svc={svc} />
        </TabsContent>
      </Tabs>
    </>
  )
}

