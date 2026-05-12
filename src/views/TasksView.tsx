import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import type { Task } from '@/lib/types'
import { useApp } from '@/store/app'

import { TaskTable } from './parts/tables'
import { ErrorState, PageHeader, ReadOnlyBanner, ScopeCrumbs, Segmented, Toolbar } from './parts/ui'

/** Reload period of task lists that the poller does not send. */
const RELOAD_MS = 15_000

/** Tasks of every cluster in the region. The poller sends only the focused service, so this loads on demand. */
export function useRegionTasks(state: 'RUNNING' | 'STOPPED') {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const clusterNames = useApp((s) => s.clusters.map((c) => c.name).join(','))
  const polledAt = useApp((s) => s.polledAt)
  const tick = polledAt ? Math.floor(polledAt / RELOAD_MS) : 0
  return useAsync<Task[]>(
    profile && region && clusterNames
      ? async () => {
          const lists = await Promise.all(clusterNames.split(',').map((c) => api.listTasks(profile, region, c, null, state)))
          return lists.flat()
        }
      : null,
    [profile, region, clusterNames, state, tick],
  )
}

export function TasksView() {
  const services = useApp((s) => s.services)
  const loadingScope = useApp((s) => s.loadingScope)
  const [state, setState] = useState<'RUNNING' | 'STOPPED'>('RUNNING')
  const [q, setQ] = useState('')
  const { data, error, loading, reload } = useRegionTasks(state)

  const f = q.trim().toLowerCase()
  const list = (data ?? []).filter(
    (t) => !f || t.id.includes(f) || (t.serviceName ?? '').toLowerCase().includes(f) || (t.privateIp ?? '').includes(f),
  )
  const activeCount = services.reduce((a, s) => a + s.running + s.pending, 0)

  return (
    <>
      <ScopeCrumbs items={[{ label: 'Tasks' }]} />
      <PageHeader title="Tasks" sub={`${activeCount} active tasks across ${services.length} services`} />
      <ReadOnlyBanner />
      <Toolbar>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by task ID, service, or IP" aria-label="Filter tasks" className="h-8 w-72" />
        <Segmented
          label="Task state"
          value={state}
          onChange={setState}
          options={[
            { value: 'RUNNING', label: 'Active' },
            { value: 'STOPPED', label: 'Stopped' },
          ]}
        />
      </Toolbar>
      {error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data && (loading || loadingScope) ? (
        <Skeleton className="h-60 rounded-2xl" />
      ) : (
        <TaskTable tasks={list} empty={state === 'STOPPED' && !f ? 'No stopped tasks. ECS keeps stopped tasks for about one hour.' : undefined} />
      )}
    </>
  )
}
