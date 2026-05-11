import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useApp } from '@/store/app'

import { ServiceTable } from './parts/tables'
import { ErrorState, PageHeader, ReadOnlyBanner, ScopeCrumbs, Segmented, Toolbar } from './parts/ui'

type StateFilter = 'all' | 'healthy' | 'deploying' | 'attention'

export function ServicesView() {
  const services = useApp((s) => s.services)
  const clusters = useApp((s) => s.clusters)
  const loading = useApp((s) => s.loadingScope)
  const scopeError = useApp((s) => s.scopeError)
  const loadScope = useApp((s) => s.loadScope)
  const [q, setQ] = useState('')
  const [state, setState] = useState<StateFilter>('all')

  let list = services
  if (state !== 'all') list = list.filter((s) => (state === 'attention' ? s.health !== 'healthy' : s.health === state))
  const f = q.trim().toLowerCase()
  if (f) list = list.filter((s) => s.name.toLowerCase().includes(f))

  return (
    <>
      <ScopeCrumbs items={[{ label: 'Services' }]} />
      <PageHeader title="Services" sub={`${services.length} services in ${clusters.length} clusters`} />
      <ReadOnlyBanner />
      <Toolbar>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name" aria-label="Filter services" className="h-8 w-60" />
        <Segmented
          label="Service state"
          value={state}
          onChange={setState}
          options={[
            { value: 'all', label: 'All' },
            { value: 'healthy', label: 'Healthy' },
            { value: 'deploying', label: 'Deploying' },
            { value: 'attention', label: 'Needs attention' },
          ]}
        />
      </Toolbar>
      {scopeError && !services.length ? (
        <ErrorState error={scopeError} onRetry={() => void loadScope()} />
      ) : loading && !services.length ? (
        <Skeleton className="h-60 rounded-2xl" />
      ) : (
        <ServiceTable services={list} />
      )}
    </>
  )
}
