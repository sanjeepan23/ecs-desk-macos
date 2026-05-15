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

function TaskDetail({ task, crumbs }: { task: Task; crumbs: { label: string; onClick?: () => void }[] }) {
  const actions = useServiceActions()
  const navigate = useApp((s) => s.navigate)
  const stopped = task.lastStatus === 'STOPPED'
  const exitCode = task.containers.find((c) => c.exitCode != null && c.exitCode !== 0)?.exitCode ?? task.containers.find((c) => c.exitCode != null)?.exitCode
  const oom = exitCode === 137 || /outofmemory/i.test(task.stopReason ?? '')

  return (
    <>
      <ScopeCrumbs items={crumbs} />
      <PageHeader
        title={task.id}
        mono
        sub={
          <>
            <TaskStatusBadge status={task.lastStatus} />
            <HealthCheckBadge health={task.healthStatus} />
            <Tag>{taskDefShort(task.taskDefinition)}</Tag>
            {task.availabilityZone && <Tag>{task.availabilityZone}</Tag>}
            {task.privateIp && <Tag>{task.privateIp}</Tag>}
          </>
        }
        actions={
          <>
            <CopyButton text={task.arn} size="default">
              Copy ARN
            </CopyButton>
            {!stopped && (
              <ActionButton icon={ComputerTerminal01Icon} onClick={() => actions.exec(task)}>
                Exec
              </ActionButton>
            )}
            {!stopped && (
              <ActionButton icon={StopIcon} onClick={() => actions.stopTask(task)}>
                Stop task
              </ActionButton>
            )}
          </>
        }
      />
      <ReadOnlyBanner />
      {task.stopReason && (
        <Banner
          tone="crit"
          icon={Alert02Icon}
          action={
            oom ? (
              <Button
                size="sm"
                variant="outline"
                className="bg-background"
                onClick={() =>
                  toast.info('Editing task definitions comes after v1.', {
                    description: 'Copy the JSON from the Task definition tab, and register a new revision with more memory.',
                  })
                }
              >
                Raise memory
              </Button>
            ) : undefined
          }
        >
          <b>{stopped ? 'Stopped.' : 'Stopping.'}</b> {task.stopReason}{' '}
          {exitCode != null && <span className="text-muted-foreground">Exit code {exitCode}.</span>}
        </Banner>
      )}

      <SectionTitle>Containers</SectionTitle>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
        {task.containers.map((c) => (
          <ContainerCard
            key={c.name}
            c={c}
            onExec={() => actions.exec(task, c.name)}
            onLogs={
              task.serviceName
                ? () => navigate({ name: 'service', cluster: task.clusterName, service: task.serviceName!, tab: 'logs' })
                : undefined
            }
          />
        ))}
      </div>

      <SectionTitle>Task</SectionTitle>
      <Panel title="Details">
        <KV
          rows={[
            ['Started', task.startedAt ? `${dateTime(task.startedAt)} (${ago(task.startedAt)})` : 'Not started yet'],
            ...(task.stoppedAt ? ([['Stopped', `${dateTime(task.stoppedAt)} (${ago(task.stoppedAt)})`]] as [string, string][]) : []),
            ...(task.stopCode ? ([['Stop code', <span className="font-mono text-xs">{task.stopCode}</span>]] as [string, ReactNode][]) : []),
            ['Desired status', titleCase(task.desiredStatus)],
            ['Launch type', task.launchType ?? '—'],
            ['Task size', taskSize(task.cpu, task.memory)],
            ['Zone', <span className="font-mono text-xs">{task.availabilityZone ?? '—'}</span>],
            ['Private IP', <span className="font-mono text-xs">{task.privateIp ?? '—'}</span>],
            ['Exec', task.enableExecuteCommand ? 'Enabled' : 'Off: enableExecuteCommand is false'],
            ['Task definition', <span className="font-mono text-xs">{task.taskDefinition}</span>],
            ['ARN', <span className="font-mono text-xs">{task.arn}</span>],
          ]}
        />
      </Panel>
    </>
  )
}

