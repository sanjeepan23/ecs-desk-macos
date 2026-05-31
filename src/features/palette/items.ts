// Pure item model and filter for the command palette.

import type { ServiceHealth } from '@/lib/types'

export type PaletteGroup = 'Go to' | 'Services' | 'Clusters' | 'Tasks' | 'Profiles' | 'Actions'

export const GROUP_ORDER: PaletteGroup[] = ['Go to', 'Services', 'Clusters', 'Tasks', 'Profiles', 'Actions']

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  hint?: string
  health?: ServiceHealth
  /** Extra search words that do not show. */
  keywords?: string[]
  run: () => void
}

/** Max items per group when the query is empty, and when it is not. */
export const GROUP_LIMIT = { empty: 8, query: 25 }

function haystack(it: PaletteItem): string {
  return [it.label, it.hint ?? '', ...(it.keywords ?? [])].join(' ').toLowerCase()
}

/** Every word of the query must occur in the label, hint, or keywords. */
export function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const limit = words.length ? GROUP_LIMIT.query : GROUP_LIMIT.empty
  const counts = new Map<PaletteGroup, number>()
  const matched = items.filter((it) => {
    if (!words.length) return true
    const h = haystack(it)
    return words.every((w) => h.includes(w))
  })
  // Rank items whose label starts with the query first, inside each group.
  const q = words.join(' ')
  const ranked = matched
    .map((it, i) => ({ it, i, score: q && it.label.toLowerCase().startsWith(q) ? 0 : 1 }))
    .sort((a, b) => GROUP_ORDER.indexOf(a.it.group) - GROUP_ORDER.indexOf(b.it.group) || a.score - b.score || a.i - b.i)
  const out: PaletteItem[] = []
  for (const { it } of ranked) {
    const n = counts.get(it.group) ?? 0
    if (n >= limit) continue
    counts.set(it.group, n + 1)
    out.push(it)
  }
  return out
}

export function groupItems(items: PaletteItem[]): [PaletteGroup, PaletteItem[]][] {
  return GROUP_ORDER.map((g) => [g, items.filter((it) => it.group === g)] as [PaletteGroup, PaletteItem[]]).filter(
    ([, list]) => list.length > 0,
  )
}
