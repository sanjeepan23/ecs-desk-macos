// Domain tables and row menus for clusters, services, tasks, and events.

import {
  ComputerTerminal01Icon,
  Copy01Icon,
  CubeIcon,
  Layers01Icon,
  MoreHorizontalIcon,
  Rocket01Icon,
  StopIcon,
  TextAlignLeftIcon,
  Undo02Icon,
  ArrowExpandIcon,
  LockIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { pickContainer, useServiceActions } from '@/features/actions'
import { ago, hms, pct, shortId, taskDefRevision, taskSize } from '@/lib/format'
import { clusterHealth, clusterTotals, eventTone, healthMeta, primaryDeployment } from '@/lib/status'
import type { ClusterSummary, ServiceEvent, ServiceSummary, Task } from '@/lib/types'
import { selectReadOnly, useApp } from '@/store/app'

import { DataTable, StopRowClick, type Column } from './DataTable'
import { copyText, HealthBadge, HealthCheckBadge, Icon, StatusDot, TaskStatusBadge, ToneBadge, UsageBar } from './ui'

/* ---------- Clusters ---------- */

export function ClusterTable({ clusters, services }: { clusters: ClusterSummary[]; services: ServiceSummary[] }) {
  const navigate = useApp((s) => s.navigate)
  const cols: Column<ClusterSummary>[] = [
    { id: 'name', header: 'Cluster', sort: (c) => c.name, cell: (c) => <span className="font-semibold">{c.name}</span> },
    { id: 'services', header: 'Services', sort: (c) => c.activeServices, cell: (c) => <span className="num">{c.activeServices}</span> },
    {
      id: 'tasks',
      header: 'Running tasks',
      sort: (c) => c.runningTasks,
      cell: (c) => {
        const t = clusterTotals(c, services)
        return (
          <div className="flex items-center gap-2.5">
            <UsageBar className="w-[90px]" value={pct(t.running, t.desired)} tone={t.running < t.desired ? 'warn' : 'ok'} />
            <span className="num">
              {t.running} / {t.desired}
            </span>
          </div>
        )
      },
    },
    {
      id: 'health',
      header: 'Health',
      cell: (c) => {
        const h = clusterHealth(services.filter((s) => s.clusterName === c.name))
        return <ToneBadge tone={h.tone}>{h.label}</ToneBadge>
      },
    },
    {
      id: 'cap',
      header: 'Capacity providers',
      cell: (c) => <span className="font-mono text-xs">{c.capacityProviders.join(', ') || '—'}</span>,
    },
    {
      id: 'insights',
      header: 'Container Insights',
      cell: (c) => (
        <ToneBadge tone={c.containerInsights ? 'ok' : 'neutral'} dot={false}>
          {c.containerInsights ? 'On' : 'Off'}
        </ToneBadge>
      ),
    },
  ]
  return (
    <DataTable
      rows={clusters}
      columns={cols}
      rowKey={(c) => c.arn}
      rowLabel={(c) => `Open cluster ${c.name}`}
      onRowClick={(c) => navigate({ name: 'cluster', cluster: c.name })}
      empty="No clusters in this region."
    />
  )
}

/* ---------- Services ---------- */

export function ServiceMenu({ svc, trigger = 'icon' }: { svc: ServiceSummary; trigger?: 'icon' | 'button' }) {
  const navigate = useApp((s) => s.navigate)
  const readOnly = useApp(selectReadOnly)
  const actions = useServiceActions()
  const prevRev = (taskDefRevision(svc.taskDefinition) ?? 1) - 1
  const lock = (icon: Parameters<typeof Icon>[0]['icon']) => <Icon icon={readOnly ? LockIcon : icon} />
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={trigger === 'icon' ? 'ghost' : 'outline'} size={trigger === 'icon' ? 'icon-sm' : 'icon'} aria-label={`Actions for ${svc.name}`}>
          <Icon icon={MoreHorizontalIcon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{svc.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate({ name: 'service', cluster: svc.clusterName, service: svc.name })}>
          <Icon icon={Layers01Icon} />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ name: 'service', cluster: svc.clusterName, service: svc.name, tab: 'logs' })}>
          <Icon icon={TextAlignLeftIcon} />
          View logs
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => actions.forceDeploy(svc)}>
          {lock(Rocket01Icon)}
          Force new deployment
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.scale(svc)}>
          {lock(ArrowExpandIcon)}
          Scale
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.rollback(svc)} disabled={prevRev < 1}>
          {lock(Undo02Icon)}
          Roll back to :{prevRev}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void copyText(svc.arn)}>
          <Icon icon={Copy01Icon} />
          Copy ARN
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TaskCount({ svc }: { svc: ServiceSummary }) {
  return (
    <div className="flex items-center gap-2.5">
      <UsageBar className="w-[70px]" value={pct(svc.running, svc.desired)} tone={healthMeta(svc.health).tone} />
      <span className="num">
        {svc.running}/{svc.desired}
      </span>
      {svc.pending > 0 && <span className="num text-muted-foreground">+{svc.pending}</span>}
    </div>
  )
}

export function ServiceTable({ services, showCluster = true }: { services: ServiceSummary[]; showCluster?: boolean }) {
  const navigate = useApp((s) => s.navigate)
  const cols: Column<ServiceSummary>[] = [
    { id: 'name', header: 'Service', sort: (s) => s.name, cell: (s) => <span className="font-semibold">{s.name}</span> },
    ...(showCluster
      ? [{ id: 'cluster', header: 'Cluster', sort: (s: ServiceSummary) => s.clusterName, cell: (s: ServiceSummary) => <span className="text-muted-foreground">{s.clusterName}</span> }]
      : []),
    { id: 'status', header: 'Status', sort: (s) => ['failing', 'degraded', 'deploying', 'healthy'].indexOf(s.health), cell: (s) => <HealthBadge health={s.health} /> },
    { id: 'tasks', header: 'Tasks', sort: (s) => s.running, cell: (s) => <TaskCount svc={s} /> },
    { id: 'td', header: 'Task definition', sort: (s) => s.taskDefinitionShort, cell: (s) => <span className="font-mono text-xs">{s.taskDefinitionShort}</span> },
    { id: 'launch', header: 'Launch type', cell: (s) => <span className="text-muted-foreground">{s.launchType ?? '—'}</span> },
    {
      id: 'deploy',
      header: 'Last deploy',
      sort: (s) => primaryDeployment(s)?.createdAt ?? 0,
      cell: (s) => <span className="text-muted-foreground">{ago(primaryDeployment(s)?.createdAt)}</span>,
    },
    {
      id: 'menu',
      header: <span className="sr-only">Actions</span>,
      className: 'w-10 py-1.5',
      cell: (s) => (
        <StopRowClick>
          <ServiceMenu svc={s} />
        </StopRowClick>
      ),
    },
  ]
  return (
    <DataTable
      rows={services}
      columns={cols}
      rowKey={(s) => s.arn}
      rowLabel={(s) => `Open service ${s.name}`}
      onRowClick={(s) => navigate({ name: 'service', cluster: s.clusterName, service: s.name })}
      empty="No services match this filter."
    />
  )
}

/* ---------- Tasks ---------- */

export function TaskMenu({ task }: { task: Task }) {
  const navigate = useApp((s) => s.navigate)
  const readOnly = useApp(selectReadOnly)
  const actions = useServiceActions()
  const stopped = task.lastStatus === 'STOPPED'
  const container = pickContainer(task)?.name
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for task ${shortId(task.id)}`}>
          <Icon icon={MoreHorizontalIcon} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-mono text-xs text-muted-foreground">{shortId(task.id)}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => navigate({ name: 'task', cluster: task.clusterName, service: task.serviceName, taskArn: task.arn })}>
          <Icon icon={CubeIcon} />
          Open
        </DropdownMenuItem>
        {!stopped && (
          <DropdownMenuItem onSelect={() => actions.exec(task, container)}>
            <Icon icon={readOnly ? LockIcon : ComputerTerminal01Icon} />
            Exec into {container ?? 'container'}
          </DropdownMenuItem>
        )}
        {task.serviceName && (
          <DropdownMenuItem onSelect={() => navigate({ name: 'service', cluster: task.clusterName, service: task.serviceName!, tab: 'logs' })}>
            <Icon icon={TextAlignLeftIcon} />
            View logs
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void copyText(task.arn)}>
          <Icon icon={Copy01Icon} />
          Copy ARN
        </DropdownMenuItem>
        {!stopped && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => actions.stopTask(task)}>
              <Icon icon={readOnly ? LockIcon : StopIcon} />
              Stop task
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TaskTable({ tasks, showService = true, empty }: { tasks: Task[]; showService?: boolean; empty?: string }) {
  const navigate = useApp((s) => s.navigate)
  const cols: Column<Task>[] = [
    { id: 'id', header: 'Task', sort: (t) => t.id, cell: (t) => <span className="font-mono text-xs font-semibold">{shortId(t.id)}</span> },
    ...(showService ? [{ id: 'svc', header: 'Service', sort: (t: Task) => t.serviceName ?? '', cell: (t: Task) => t.serviceName ?? <span className="text-muted-foreground">—</span> }] : []),
    { id: 'status', header: 'Status', sort: (t) => t.lastStatus, cell: (t) => <TaskStatusBadge status={t.lastStatus} /> },
    { id: 'health', header: 'Health', sort: (t) => t.healthStatus ?? '', cell: (t) => <HealthCheckBadge health={t.healthStatus} /> },
    { id: 'rev', header: 'Revision', sort: (t) => t.revision ?? 0, cell: (t) => <span className="font-mono text-xs">{t.revision ?? taskDefRevision(t.taskDefinition) ?? '—'}</span> },
    { id: 'az', header: 'Zone', sort: (t) => t.availabilityZone ?? '', cell: (t) => <span className="font-mono text-xs">{t.availabilityZone ?? '—'}</span> },
    { id: 'ip', header: 'Private IP', sort: (t) => t.privateIp ?? '', cell: (t) => <span className="font-mono text-xs">{t.privateIp ?? '—'}</span> },
    { id: 'size', header: 'Size', cell: (t) => <span className="num text-muted-foreground">{taskSize(t.cpu, t.memory)}</span> },
    {
      id: 'started',
      header: 'Started',
      sort: (t) => t.startedAt ?? 0,
      cell: (t) => <span className="text-muted-foreground">{t.startedAt ? ago(t.startedAt) : 'Starting'}</span>,
    },
    {
      id: 'menu',
      header: <span className="sr-only">Actions</span>,
      className: 'w-10 py-1.5',
      cell: (t) => (
        <StopRowClick>
          <TaskMenu task={t} />
        </StopRowClick>
      ),
    },
  ]
  return (
    <DataTable
      rows={tasks}
      columns={cols}
      rowKey={(t) => t.arn}
      rowLabel={(t) => `Open task ${shortId(t.id)}`}
      onRowClick={(t) => navigate({ name: 'task', cluster: t.clusterName, service: t.serviceName, taskArn: t.arn })}
      empty={empty ?? 'No tasks match this filter.'}
    />
  )
}

/* ---------- Events ---------- */

export interface EventRow {
  event: ServiceEvent
  cluster: string
  service: string
}

