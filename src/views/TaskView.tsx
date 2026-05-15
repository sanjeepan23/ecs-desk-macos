import type { ReactNode } from 'react'
import { Alert02Icon, ComputerTerminal01Icon, StopIcon, TextAlignLeftIcon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useServiceActions } from '@/features/actions'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { ago, dateTime, shortId, taskDefShort, taskIdFromArn, taskSize, titleCase } from '@/lib/format'
import { taskStatusTone } from '@/lib/status'
import type { Container, Task } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

import {
  ActionButton,
  Banner,
  CopyButton,
  ErrorState,
  HealthCheckBadge,
  Icon,
  KV,
  PageHeader,
  Panel,
  ReadOnlyBanner,
  ScopeCrumbs,
  SectionTitle,
  Tag,
  TaskStatusBadge,
  ToneBadge,
} from './parts/ui'

export function TaskView({ cluster, service, taskArn }: { cluster: string; service: string | null; taskArn: string }) {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const live = useApp((s) => s.tasks.find((t) => t.arn === taskArn))
  const polledAt = useApp((s) => s.polledAt)
  const navigate = useApp((s) => s.navigate)
  const tick = polledAt ? Math.floor(polledAt / 15_000) : 0
  // The poller sends tasks of the focused service. Load the task here when it is not in that list.
  const fetched = useAsync<Task>(
    profile && region && !live ? () => api.getTask(profile, region, cluster, taskArn) : null,
    [profile, region, cluster, taskArn, !!live, tick],
  )
  const task = live ?? fetched.data
  const id = taskIdFromArn(taskArn)

  const crumbs = [
    { label: cluster, onClick: () => navigate({ name: 'cluster', cluster }) },
    ...(service ? [{ label: service, onClick: () => navigate({ name: 'service', cluster, service, tab: 'tasks' }) }] : []),
    { label: shortId(id) },
  ]

  if (!task) {
    return (
      <>
        <ScopeCrumbs items={crumbs} />
        <PageHeader title={id} mono />
        {fetched.error ? <ErrorState error={fetched.error} onRetry={fetched.reload} /> : <Skeleton className="h-60 rounded-2xl" />}
      </>
    )
  }
  return <TaskDetail task={task} crumbs={crumbs} />
}

