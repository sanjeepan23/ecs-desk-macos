import { useMemo, useState } from 'react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LogsPanel } from '@/features/logs'
import { useApp } from '@/store/app'

import { EmptyState, PageHeader, ScopeCrumbs } from './parts/ui'

const ALL = '__all__'

export function LogsView() {
  const services = useApp((s) => s.services)
  const [scope, setScope] = useState(ALL)
  const filtered = scope === ALL ? services : services.filter((s) => s.arn === scope)
  // Keep the array stable across polls, so the log tail does not restart on each update.
  const key = filtered.map((s) => `${s.arn}@${s.taskDefinition}`).join('|')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const picked = useMemo(() => filtered, [key])
  const one = scope !== ALL ? picked[0] : null

  return (
    <>
      <ScopeCrumbs items={[{ label: 'Logs' }]} />
      <PageHeader
        title="Logs"
        sub={`CloudWatch Logs live tail for ${one ? one.name : 'all services'}`}
        actions={
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger size="sm" aria-label="Service" className="min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ALL}>All services</SelectItem>
              {services.map((s) => (
                <SelectItem key={s.arn} value={s.arn}>
                  {s.name} <span className="text-muted-foreground">· {s.clusterName}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {picked.length ? <LogsPanel services={picked} /> : <EmptyState>No services in this region.</EmptyState>}
    </>
  )
}
