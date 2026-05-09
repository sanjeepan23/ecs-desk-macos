import { useState, type ReactNode } from 'react'
import { ArrowRight01Icon, DashboardSquare02Icon, Globe02Icon, Login01Icon, RefreshIcon, UserIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAccount } from '@/lib/format'
import { healthMeta } from '@/lib/status'
import { cn } from '@/lib/utils'
import { selectProfile, useApp } from '@/store/app'
import { Icon, StatusDot } from '@/views/parts/ui'

function Node({
  level,
  selected,
  onClick,
  children,
  title,
  expanded,
}: {
  level: 1 | 2 | 3 | 4
  selected?: boolean
  onClick: () => void
  children: ReactNode
  title?: string
  expanded?: boolean
}) {
  const pad = { 1: 'pl-2', 2: 'pl-[22px]', 3: 'pl-9', 4: 'pl-[52px]' }[level]
  return (
    <button
      type="button"
      title={title}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-lg py-[5px] pr-2 text-left whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        pad,
        selected && 'bg-info-bg font-semibold text-info hover:bg-info-bg',
      )}
    >
      {children}
    </button>
  )
}

function Chevron({ open }: { open: boolean }) {
  return <Icon icon={ArrowRight01Icon} size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-90')} />
}

export function ResourceTree() {
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const profile = useApp(selectProfile)
  const region = useApp((s) => s.region)
  const clusters = useApp((s) => s.clusters)
  const services = useApp((s) => s.services)
  const view = useApp((s) => s.view)
  const loading = useApp((s) => s.loadingScope)
  const scopeError = useApp((s) => s.scopeError)
  const navigate = useApp((s) => s.navigate)
  const setRegion = useApp((s) => s.setRegion)
  const refresh = useApp((s) => s.refresh)
  const login = useApp((s) => s.login)

  const f = filter.trim().toLowerCase()
  const selCluster = view.name === 'cluster' ? view.cluster : null
  const selService = view.name === 'service' || view.name === 'task' ? { cluster: view.cluster, service: view.service } : null

  const toggle = (name: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })

  return (
    <aside aria-label="Resources" className="hidden min-h-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Resources</h2>
        <div className="flex-1" />
        <Button variant="ghost" size="icon-xs" aria-label="Refresh" onClick={() => void refresh()}>
          <Icon icon={RefreshIcon} className={cn(loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="px-3 pb-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter resources" className="h-8 rounded-lg bg-muted" />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {profile && (
          <Node level={1} onClick={() => navigate({ name: 'overview' })} title={profile.name}>
            <Icon icon={UserIcon} />
            <span className="min-w-0 flex-1 truncate">
              <b>{profile.name}</b> <span className="font-mono text-xs text-muted-foreground">{formatAccount(profile.accountId)}</span>
            </span>
          </Node>
        )}
        {profile?.regions.map((reg) => {
          const on = reg === region
          return (
            <div key={reg}>
              <Node level={2} expanded={on} onClick={() => (on ? navigate({ name: 'overview' }) : void setRegion(reg))}>
                <Chevron open={on} />
                <Icon icon={Globe02Icon} />
                <span className="flex-1 truncate font-mono text-xs">{reg}</span>
              </Node>
              {on && loading && !clusters.length && (
                <div className="space-y-1.5 py-1 pr-2 pl-9">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              )}
              {on && scopeError && !clusters.length && (
                <div className="py-1.5 pr-2 pl-9 text-xs text-muted-foreground">
                  {scopeError.kind === 'auth' ? (
                    <Button size="xs" variant="outline" onClick={() => void login()}>
                      <Icon icon={Login01Icon} />
                      Log in
                    </Button>
                  ) : (
                    'Clusters did not load.'
                  )}
                </div>
              )}
              {on &&
                clusters.map((c) => {
                  const own = services.filter((s) => s.clusterName === c.name)
                  const shown = own.filter((s) => !f || s.name.toLowerCase().includes(f) || c.name.toLowerCase().includes(f))
                  if (f && !shown.length) return null
                  const open = !!f || !collapsed.has(c.name)
                  return (
                    <div key={c.arn}>
                      <Node
                        level={3}
                        expanded={open}
                        selected={selCluster === c.name}
                        onClick={() => {
                          if (selCluster === c.name || !open) toggle(c.name)
                          navigate({ name: 'cluster', cluster: c.name })
                        }}
                      >
                        <Chevron open={open} />
                        <Icon icon={DashboardSquare02Icon} />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="text-[11px] text-muted-foreground">{own.length || c.activeServices}</span>
                      </Node>
                      {open &&
                        shown.map((s) => (
                          <Node
                            key={s.arn}
                            level={4}
                            selected={selService?.cluster === c.name && selService.service === s.name}
                            onClick={() => navigate({ name: 'service', cluster: c.name, service: s.name })}
                          >
                            <StatusDot tone={healthMeta(s.health).tone} />
                            <span className="min-w-0 flex-1 truncate">{s.name}</span>
                            <span className="num text-[11px] text-muted-foreground">
                              {s.running}/{s.desired}
                            </span>
                          </Node>
                        ))}
                    </div>
                  )
                })}
            </div>
          )
        })}
        {f && matchCount(clusters, services, f) === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">No resources match "{filter}".</div>}
      </div>
    </aside>
  )
}

function matchCount(clusters: { name: string }[], services: { name: string; clusterName: string }[], f: string): number {
  return services.filter((s) => s.name.toLowerCase().includes(f) || s.clusterName.toLowerCase().includes(f)).length + clusters.filter((c) => c.name.toLowerCase().includes(f)).length
}
