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

