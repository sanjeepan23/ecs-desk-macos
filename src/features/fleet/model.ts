// Pure helpers for the "All accounts" page.

import type { FleetEntry, Profile, ServiceHealth } from '@/lib/types'

export interface FleetGroup {
  profile: string
  accountId: string | null
  isProd: boolean
  entries: FleetEntry[]
}

export interface FleetSummary {
  /** Profiles whose regions all finished scanning. */
  profilesScanned: number
  profilesTotal: number
  attention: number
  /** Failing and degraded services. */
  failing: number
  authProfiles: number
  scanning: boolean
}

const RANK: Record<ServiceHealth, number> = { failing: 0, degraded: 1, deploying: 2, healthy: 3 }

export const isDone = (e: FleetEntry) => e.status !== 'pending' && e.status !== 'scanning'

/** Replaces the entry with the same profile and region, or adds it. */
export function upsertEntry(list: FleetEntry[], e: FleetEntry): FleetEntry[] {
  const i = list.findIndex((x) => x.profile === e.profile && x.region === e.region)
  if (i < 0) return [...list, e]
  const next = list.slice()
  next[i] = e
  return next
}

/** Merges a batch of entries into the list, in batch order. */
export function mergeEntries(list: FleetEntry[], batch: FleetEntry[]): FleetEntry[] {
  return batch.reduce(upsertEntry, list)
}

/** Groups entries by profile. Profiles with problems come first, then by name. Regions keep the profile order. */
export function groupByProfile(entries: FleetEntry[], profiles: Profile[]): FleetGroup[] {
  const map = new Map<string, FleetGroup>()
  for (const e of entries) {
    let g = map.get(e.profile)
    if (!g) {
      const p = profiles.find((x) => x.name === e.profile)
      g = { profile: e.profile, accountId: p?.accountId ?? null, isProd: e.isProd || !!p?.isProd, entries: [] }
      map.set(e.profile, g)
    }
    g.entries.push(e)
    g.isProd ||= e.isProd
  }
  const regionIndex = (g: FleetGroup, r: string) => {
    const i = profiles.find((p) => p.name === g.profile)?.regions.indexOf(r) ?? -1
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const groups = [...map.values()]
  for (const g of groups) g.entries.sort((a, b) => regionIndex(g, a.region) - regionIndex(g, b.region) || a.region.localeCompare(b.region))
  return groups.sort((a, b) => groupRank(a) - groupRank(b) || a.profile.localeCompare(b.profile))
}

