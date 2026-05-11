import { Skeleton } from '@/components/ui/skeleton'
import { formatAccount, accountFromArn } from '@/lib/format'
import { useApp } from '@/store/app'

import { ClusterTable, ServiceTable } from './parts/tables'
import { ErrorState, PageHeader, ReadOnlyBanner, ScopeCrumbs, StatCard, Tag } from './parts/ui'

export function ClustersView() {
  const region = useApp((s) => s.region)
  const clusters = useApp((s) => s.clusters)
  const services = useApp((s) => s.services)
  const loading = useApp((s) => s.loadingScope)
  const scopeError = useApp((s) => s.scopeError)
  const loadScope = useApp((s) => s.loadScope)
  return (
    <>
      <ScopeCrumbs items={[{ label: 'Clusters' }]} />
      <PageHeader
        title="Clusters"
        sub={
          <span>
            {clusters.length} clusters in <span className="font-mono text-xs">{region}</span>
          </span>
        }
      />
      {scopeError && !clusters.length ? (
        <ErrorState error={scopeError} onRetry={() => void loadScope()} />
      ) : loading && !clusters.length ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <ClusterTable clusters={clusters} services={services} />
      )}
    </>
  )
}

export function ClusterView({ cluster }: { cluster: string }) {
  const c = useApp((s) => s.clusters.find((x) => x.name === cluster))
  const services = useApp((s) => s.services)
  const loading = useApp((s) => s.loadingScope)
  const navigate = useApp((s) => s.navigate)
  const own = services.filter((s) => s.clusterName === cluster)

  if (!c) {
    return (
      <>
        <ScopeCrumbs items={[{ label: 'Clusters', onClick: () => navigate({ name: 'clusters' }) }, { label: cluster }]} />
        <PageHeader title={cluster} />
        {loading ? <Skeleton className="h-40 rounded-2xl" /> : <ErrorState error={{ kind: 'notFound', message: `Cluster ${cluster} is not in this region.` }} />}
      </>
    )
  }
  return (
    <>
      <ScopeCrumbs items={[{ label: 'Clusters', onClick: () => navigate({ name: 'clusters' }) }, { label: c.name }]} />
      <PageHeader title={c.name} sub={<Tag className="max-w-full truncate">{c.arn}</Tag>} />
      <ReadOnlyBanner />
      <div className="mb-[18px] grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
        <StatCard label="Services" value={own.length || c.activeServices} />
        <StatCard label="Running tasks" value={c.runningTasks} hint={c.pendingTasks ? `${c.pendingTasks} pending` : undefined} />
        <StatCard label="Capacity providers" value={<span className="text-[15px]">{c.capacityProviders.join(', ') || '—'}</span>} />
        <StatCard
          label="Container Insights"
          value={<span className="text-[15px]">{c.containerInsights ? 'Enabled' : 'Disabled'}</span>}
          hint={`Account ${formatAccount(accountFromArn(c.arn))}`}
        />
      </div>
      <ServiceTable services={own} showCluster={false} />
    </>
  )
}
