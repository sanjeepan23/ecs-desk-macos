// Pure helpers for the metrics charts.

import type { MetricPoint } from '@/lib/types'

export interface Stats {
  now: number | null
  avg: number | null
  max: number | null
}

export const RANGES = [
  { key: '1h', label: '1h', minutes: 60 },
  { key: '6h', label: '6h', minutes: 360 },
  { key: '24h', label: '24h', minutes: 1440 },
  { key: '7d', label: '7d', minutes: 10080 },
] as const

export type RangeKey = (typeof RANGES)[number]['key']

/** Memory above this percentage shows in the destructive color. */
export const MEMORY_LIMIT_PCT = 90

export function seriesStats(points: MetricPoint[]): Stats {
  const vals = points.map((p) => p.v).filter((v) => Number.isFinite(v))
  if (!vals.length) return { now: null, avg: null, max: null }
  const sum = vals.reduce((a, b) => a + b, 0)
  return { now: vals[vals.length - 1], avg: sum / vals.length, max: Math.max(...vals) }
}

export function fmtPct(v: number | null): string {
  if (v == null) return '—'
  return `${v.toFixed(1)}%`
}

export function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v))
}

/** Sorts by time and clamps values to 0–100. */
export function prepareSeries(points: MetricPoint[]): MetricPoint[] {
  return points
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .map((p) => ({ t: p.t, v: clampPct(p.v) }))
    .sort((a, b) => a.t - b.t)
}

export function isNearLimit(stats: Stats): boolean {
  return (stats.max ?? 0) > MEMORY_LIMIT_PCT
}

/** Axis label for a timestamp. Long ranges show the day. */
export function fmtTick(t: number, rangeMinutes: number): string {
  const d = new Date(t)
  if (rangeMinutes > 1440) return d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}
