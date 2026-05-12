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

function OverviewTab({ svc, events }: { svc: ServiceSummary; events?: { id: string; createdAt: number | null; message: string }[] }) {
  const navigate = useApp((s) => s.navigate)
  const d = primaryDeployment(svc)
  const ro = rolloutMeta(d?.rolloutState)
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        <Panel title="Rollout" right={d && <ToneBadge tone={ro.tone}>{ro.label}</ToneBadge>}>
          <div className="space-y-3">
            {svc.deployments.map((x) => {
              const primary = x.status === 'PRIMARY'
              const tone = primary ? (x.rolloutState === 'IN_PROGRESS' ? 'info' : healthMeta(svc.health).tone === 'crit' ? 'crit' : 'ok') : 'fg'
              return (
                <div key={x.id}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Tag>{taskDefShort(x.taskDefinition)}</Tag>
                    <ToneBadge tone="neutral" dot={false}>
                      {deploymentStatusLabel(x.status)}
                    </ToneBadge>
                    <span className="num ml-auto text-muted-foreground">
                      {x.running} / {x.desired} running
                    </span>
                  </div>
                  <UsageBar value={pct(x.running, x.desired)} tone={tone} />
                </div>
              )
            })}
            {!svc.deployments.length && <div className="text-muted-foreground">No deployments.</div>}
            {d?.rolloutReason && <div className="text-[12.5px] text-muted-foreground">{d.rolloutReason}</div>}
          </div>
        </Panel>
        <Panel title="Details">
          <KV
            rows={[
              ['Cluster', svc.clusterName],
              ['Launch type', svc.launchType ?? '—'],
              ['Task definition', <span className="font-mono text-xs">{svc.taskDefinitionShort}</span>],
              [
                'Load balancer',
                svc.loadBalancers.length ? (
                  svc.loadBalancers.map(targetGroupName).join(', ')
                ) : (
                  <span className="text-muted-foreground">None (worker)</span>
                ),
              ],
              [
                'Exec',
                svc.enableExecuteCommand ? (
                  <ToneBadge tone="ok" dot={false}>
                    Enabled
                  </ToneBadge>
                ) : (
                  <ToneBadge tone="warn" dot={false}>
                    Off: enableExecuteCommand is false
                  </ToneBadge>
                ),
              ],
              ['Created', svc.createdAt ? `${dateTime(svc.createdAt)} (${ago(svc.createdAt)})` : '—'],
            ]}
          />
        </Panel>
      </div>
      <div className="mt-3.5">
        <StoppedSummary service={svc} />
      </div>
      <div className="mt-3.5">
        <MetricsSummary service={svc} />
      </div>
      <SectionTitle
        right={
          <Button variant="ghost" size="xs" onClick={() => navigate({ name: 'service', cluster: svc.clusterName, service: svc.name, tab: 'events' })}>
            View all
          </Button>
        }
      >
        Latest events
      </SectionTitle>
      {events ? (
        <EventsTable rows={events.slice(0, 4).map((event) => ({ event, cluster: svc.clusterName, service: svc.name }))} />
      ) : (
        <Skeleton className="h-32 rounded-2xl" />
      )}
    </>
  )
}

function TasksTab({ svc, active, initialState }: { svc: ServiceSummary; active: Task[]; initialState: 'RUNNING' | 'STOPPED' }) {
  const [state, setState] = useState<'RUNNING' | 'STOPPED'>(initialState)
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const polledAt = useApp((s) => s.polledAt)
  const tick = polledAt ? Math.floor(polledAt / 15_000) : 0
  const stopped = useAsync<Task[]>(
    profile && region ? () => api.listTasks(profile, region, svc.clusterName, svc.name, 'STOPPED') : null,
    [profile, region, svc.clusterName, svc.name, tick],
  )
  return (
    <>
      <Toolbar>
        <Segmented
          label="Task state"
          value={state}
          onChange={setState}
          options={[
            { value: 'RUNNING', label: `Active ${active.length}` },
            { value: 'STOPPED', label: stopped.data ? `Stopped ${stopped.data.length}` : 'Stopped' },
          ]}
        />
      </Toolbar>
      {state === 'RUNNING' ? (
        <TaskTable tasks={active} showService={false} empty="No active tasks." />
      ) : stopped.error && !stopped.data ? (
        <ErrorState error={stopped.error} onRetry={stopped.reload} />
      ) : !stopped.data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <>
          <StoppedGroups service={svc} />
          <TaskTable tasks={stopped.data} showService={false} empty="No stopped tasks. ECS keeps stopped tasks for about one hour." />
        </>
      )}
    </>
  )
}

function DeploymentsTab({ svc }: { svc: ServiceSummary }) {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const actions = useServiceActions()
  const family = taskDefFamily(svc.taskDefinition)
  const revs = useAsync<string[]>(
    profile && region ? () => api.listTaskDefinitionRevisions(profile, region, family) : null,
    [profile, region, family],
  )
  type Dep = ServiceSummary['deployments'][number]
  const cols: Column<Dep>[] = [
    { id: 'id', header: 'Deployment', cell: (d) => <span className="font-mono text-xs">{d.id}</span> },
    {
      id: 'status',
      header: 'Status',
      cell: (d) => (
        <ToneBadge tone="neutral" dot={false}>
          {deploymentStatusLabel(d.status)}
        </ToneBadge>
      ),
    },
    { id: 'td', header: 'Task definition', cell: (d) => <span className="font-mono text-xs">{taskDefShort(d.taskDefinition)}</span> },
    {
      id: 'rollout',
      header: 'Rollout',
      cell: (d) => {
        const m = rolloutMeta(d.rolloutState)
        return <ToneBadge tone={m.tone}>{m.label}</ToneBadge>
      },
    },
    {
      id: 'progress',
      header: 'Progress',
      cell: (d) => (
        <div className="flex items-center gap-2.5">
          <UsageBar className="w-[110px]" value={pct(d.running, d.desired)} tone={d.rolloutState === 'IN_PROGRESS' ? 'info' : 'ok'} />
          <span className="num">
            {d.running}/{d.desired}
          </span>
          {d.failed > 0 && <span className="num text-crit">{d.failed} failed</span>}
        </div>
      ),
    },
    { id: 'created', header: 'Created', cell: (d) => <span className="text-muted-foreground">{ago(d.createdAt)}</span> },
    {
      id: 'act',
      header: <span className="sr-only">Actions</span>,
      className: 'py-1.5',
      cell: (d) =>
        d === svc.deployments[0] ? (
          <ActionButton size="sm" icon={Undo02Icon} onClick={() => actions.rollback(svc)}>
            Roll back
          </ActionButton>
        ) : null,
    },
  ]
  const inUse = new Map(svc.deployments.map((d) => [taskDefShort(d.taskDefinition), deploymentStatusLabel(d.status)]))
  const revCols: Column<string>[] = [
    { id: 'rev', header: 'Revision', cell: (r) => <span className="font-mono text-xs">{taskDefShort(r)}</span> },
    {
      id: 'use',
      header: 'In use',
      cell: (r) => {
        const u = inUse.get(taskDefShort(r))
        return u ? <ToneBadge tone={u === 'Primary' ? 'ok' : 'info'}>{u}</ToneBadge> : <span className="text-muted-foreground">—</span>
      },
    },
    { id: 'arn', header: 'ARN', className: 'text-muted-foreground', cell: (r) => <span className="font-mono text-xs">{r}</span> },
  ]
  return (
    <>
      <DeployTimeline service={svc} />
      <DataTable rows={svc.deployments} columns={cols} rowKey={(d) => d.id} empty="No deployments." />
      <SectionTitle>Previous revisions</SectionTitle>
      {revs.error && !revs.data ? (
        <ErrorState error={revs.error} onRetry={revs.reload} />
      ) : !revs.data ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : (
        <DataTable rows={revs.data} columns={revCols} rowKey={(r) => r} empty="No revisions found." />
      )}
    </>
  )
}

