// One page for all profiles and regions.

import { useEffect, useMemo, useState } from 'react'
import { Alert02Icon, CheckmarkCircle02Icon, Loading03Icon, Login01Icon, RefreshIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, events } from '@/lib/api'
import { ago, formatAccount } from '@/lib/format'
import { healthMeta } from '@/lib/status'
import type { FleetEntry, ServiceSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Crumbs, EmptyState, HealthBadge, Icon, PageHeader, Panel, StatCard, StatusDot, TONE_BG, ToneBadge } from '@/views/parts/ui'

import { allHealthy, groupByProfile, mergeEntries, sortAttention, summarize, upsertEntry, type FleetGroup } from './model'

const ALL = '__all__'

const rowCls =
  'flex w-full items-center gap-3 border-t px-4 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Applies a scan result. An entry that already shows "Scanning" stays, because its event came first. */
function applyScan(prev: FleetEntry[], result: FleetEntry[], full: boolean): FleetEntry[] {
  const kept = result.map((r) => prev.find((p) => p.profile === r.profile && p.region === r.region && p.status === 'scanning') ?? r)
  return full ? kept : mergeEntries(prev, kept)
}

/** The "All accounts" page. */
export function FleetView() {
  const profiles = useApp((s) => s.profiles)
  const report = useApp((s) => s.report)
  const [entries, setEntries] = useState<FleetEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [filter, setFilter] = useState(ALL)

  const scan = async (only?: string[]) => {
    try {
      const result = await api.fleetScan(only)
      setEntries((prev) => applyScan(prev, result, !only))
    } catch (e) {
      report(e)
    }
  }

  useEffect(() => {
    let alive = true
    const off = events.onFleetEntry((e) => alive && setEntries((prev) => upsertEntry(prev, e)))
    api
      .fleetSnapshot()
      .then(async (snap) => {
        if (!alive) return
        if (snap.length) setEntries((prev) => mergeEntries(snap, prev))
        else {
          const result = await api.fleetScan()
          if (alive) setEntries((prev) => applyScan(prev, result, true))
        }
      })
      .catch((e) => alive && report(e))
      .finally(() => alive && setLoaded(true))
    return () => {
      alive = false
      void off.then((f) => f())
    }
  }, [report])

  const shown = useMemo(() => (filter === ALL ? entries : entries.filter((e) => e.profile === filter)), [entries, filter])
  const groups = useMemo(() => groupByProfile(shown, profiles), [shown, profiles])
  const sum = summarize(shown)
  const profileNames = useMemo(() => [...new Set([...profiles.map((p) => p.name), ...entries.map((e) => e.profile)])].sort(), [profiles, entries])

  return (
    <>
      <Crumbs items={[{ label: 'All accounts' }]} />
      <PageHeader
        title="All accounts"
        sub="Services that need attention in every profile and region"
        actions={
          <>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger size="sm" aria-label="Profile" className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={ALL}>All profiles</SelectItem>
                {profileNames.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void scan(filter === ALL ? undefined : [filter])} disabled={sum.scanning}>
              <Icon icon={RefreshIcon} className={cn(sum.scanning && 'animate-spin')} />
              Scan again
            </Button>
          </>
        }
      />

      {!loaded && !entries.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[104px] rounded-2xl" />
          ))}
        </div>
      ) : !shown.length ? (
        <EmptyState>No profiles to scan. Add AWS profiles to ~/.aws/config.</EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
            <StatCard
              label="Profiles scanned"
              value={
                <>
                  {sum.profilesScanned}
                  <span className="text-[15px] text-muted-foreground"> / {sum.profilesTotal}</span>
                </>
              }
              hint={sum.scanning ? 'scan in progress' : 'scan complete'}
            />
            <StatCard label="Need attention" value={sum.attention} valueClass={sum.attention ? 'text-warn' : 'text-ok'} hint="services not healthy" />
            <StatCard label="Failing" value={sum.failing} valueClass={sum.failing ? 'text-crit' : undefined} hint="tasks below desired" />
            <StatCard label="Session expired" value={sum.authProfiles} valueClass={sum.authProfiles ? 'text-crit' : undefined} hint="profiles to log in" />
          </div>

          {!sum.scanning && allHealthy(shown) && (
            <div className="mt-3.5 flex items-center gap-2 rounded-2xl bg-ok-bg px-3.5 py-2.5 text-ok">
              <Icon icon={CheckmarkCircle02Icon} />
              All services are healthy in {sum.profilesTotal} {sum.profilesTotal === 1 ? 'profile' : 'profiles'}.
            </div>
          )}

          <div className="mt-3.5 flex flex-col gap-3.5">
            {groups.map((g) => (
              <ProfileCard key={g.profile} group={g} onRescan={() => void scan([g.profile])} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

