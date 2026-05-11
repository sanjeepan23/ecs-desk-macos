import { RefreshIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ago, hms } from '@/lib/format'
import { attentionText, eventTone, healthMeta, needsAttention } from '@/lib/status'
import { cn } from '@/lib/utils'
import { eventKey, useApp } from '@/store/app'

import { ClusterTable } from './parts/tables'
import { EmptyState, ErrorState, HealthBadge, Icon, PageHeader, Panel, ReadOnlyBanner, ScopeCrumbs, SectionTitle, StatCard, TONE_BG } from './parts/ui'
import { useScopeEvents } from './useScopeEvents'

const rowCls =
  'flex w-full items-center gap-3 border-t px-4 py-3 text-left outline-none first:border-t-0 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

export function OverviewView() {
  const region = useApp((s) => s.region)
  const clusters = useApp((s) => s.clusters)
  const services = useApp((s) => s.services)
  const events = useApp((s) => s.events)
  const loading = useApp((s) => s.loadingScope)
  const scopeError = useApp((s) => s.scopeError)
  const refresh = useApp((s) => s.refresh)
  const loadScope = useApp((s) => s.loadScope)
  const navigate = useApp((s) => s.navigate)
  const recent = useScopeEvents().slice(0, 6)

  const count = (h: string) => services.filter((s) => s.health === h).length
  const running = services.reduce((a, s) => a + s.running, 0)
  const desired = services.reduce((a, s) => a + s.desired, 0)
  const attn = services.filter(needsAttention)

  return (
    <>
      <ScopeCrumbs items={[{ label: 'Overview' }]} />
      <PageHeader
        title="Overview"
        sub={
          <>
            <span>{clusters.length} clusters</span>·<span>{services.length} services</span>·<span className="font-mono text-xs">{region}</span>
          </>
        }
        actions={
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <Icon icon={RefreshIcon} className={cn(loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />
      <ReadOnlyBanner />
      {scopeError && !clusters.length ? (
        <ErrorState error={scopeError} onRetry={() => void loadScope()} />
      ) : loading && !clusters.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
            <StatCard
              label="Running tasks"
              value={
                <>
                  {running}
                  <span className="text-[15px] text-muted-foreground"> / {desired}</span>
                </>
              }
              hint="desired across all services"
            />
            <StatCard label="Healthy services" value={count('healthy')} valueClass="text-ok" hint="steady state" />
            <StatCard label="Deploying" value={count('deploying')} valueClass="text-info" hint="rollouts in progress" />
            <StatCard label="Failing" value={count('failing') + count('degraded')} valueClass="text-crit" hint="tasks below desired" />
          </div>

          <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3.5">
            <Panel title="Needs attention" right={<span className="text-muted-foreground">{attn.length}</span>} flush>
              {attn.length ? (
                attn.map((s) => {
                  const tone = healthMeta(s.health).tone
                  return (
                    <button
                      key={s.arn}
                      type="button"
                      className={rowCls}
                      onClick={() => navigate({ name: 'service', cluster: s.clusterName, service: s.name })}
                    >
                      <span className={cn('w-1 self-stretch rounded', TONE_BG[tone])} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">
                          {s.name} <span className="font-normal text-muted-foreground">· {s.clusterName}</span>
                        </div>
                        <div className="truncate text-[12.5px] text-muted-foreground">{attentionText(s, events[eventKey(s.clusterName, s.name)])}</div>
                      </div>
                      <HealthBadge health={s.health} />
                    </button>
                  )
                })
              ) : (
                <div className="p-8 text-center text-muted-foreground">All services are at steady state.</div>
              )}
            </Panel>
            <Panel
              title="Recent events"
              flush
              right={
                <Button variant="ghost" size="xs" onClick={() => navigate({ name: 'events' })}>
                  View all
                </Button>
              }
            >
              {recent.length ? (
                recent.map((r) => (
                  <button
                    key={`${r.cluster}/${r.service}/${r.event.id}`}
                    type="button"
                    className={rowCls}
                    onClick={() => navigate({ name: 'service', cluster: r.cluster, service: r.service, tab: 'events' })}
                  >
                    <span className={cn('w-1 self-stretch rounded', TONE_BG[eventTone(r.event.message)])} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px]">{r.event.message}</div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {ago(r.event.createdAt)} · {hms(r.event.createdAt)}
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              )}
            </Panel>
          </div>

          <SectionTitle>Clusters</SectionTitle>
          {clusters.length ? <ClusterTable clusters={clusters} services={services} /> : <EmptyState>No clusters in {region}.</EmptyState>}
        </>
      )}
    </>
  )
}
