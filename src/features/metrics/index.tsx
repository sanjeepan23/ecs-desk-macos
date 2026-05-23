// CPU and memory charts.

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, ChartLineData01Icon, Loading03Icon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, asAppError } from '@/lib/api'
import type { MetricPoint, ServiceMetrics, ServiceSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

import { fmtPct, fmtTick, isNearLimit, prepareSeries, RANGES, seriesStats, type RangeKey, type Stats } from './stats'

const POLL_MS = 60_000

// Series colors per theme. The memory color changes to --destructive above the limit.
const COLOR_VARS = '[--metric-cpu:#2a78d6] [--metric-mem:#008a3e] dark:[--metric-cpu:#3987e5] dark:[--metric-mem:#2fb565]'

interface MetricsState {
  data: { cpu: MetricPoint[]; memory: MetricPoint[]; periodSecs: number } | null
  error: string | null
  loading: boolean
  updatedAt: number | null
}

/** Loads metrics for one service and polls every 60 s while mounted. */
function useMetrics(service: ServiceSummary, rangeMinutes: number): MetricsState {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const [state, setState] = useState<MetricsState>({ data: null, error: null, loading: true, updatedAt: null })

  useEffect(() => {
    if (!profile || !region) return
    let live = true
    setState((s) => ({ ...s, loading: true, data: null, error: null }))
    const load = () =>
      api
        .getMetrics(profile, region, service.clusterName, service.name, rangeMinutes)
        .then((m: ServiceMetrics) => {
          if (!live) return
          setState({
            data: { cpu: prepareSeries(m.cpu), memory: prepareSeries(m.memory), periodSecs: m.periodSecs },
            error: null,
            loading: false,
            updatedAt: Date.now(),
          })
        })
        .catch((e) => live && setState((s) => ({ ...s, loading: false, error: asAppError(e).message })))
    void load()
    const h = setInterval(load, POLL_MS)
    return () => {
      live = false
      clearInterval(h)
    }
  }, [profile, region, service.clusterName, service.name, rangeMinutes])

  return state
}

function fmtPeriod(secs: number): string {
  if (secs < 60) return `${secs}-second`
  if (secs < 3600) return `${Math.round(secs / 60)}-minute`
  return `${Math.round(secs / 3600)}-hour`
}

function TooltipBody({ active, payload, rangeMinutes }: { active?: boolean; payload?: { payload: MetricPoint }[]; rangeMinutes: number }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  const d = new Date(p.t)
  const when =
    rangeMinutes > 1440
      ? d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <div className="rounded-lg bg-foreground px-2 py-1 text-xs text-background shadow-md">
      <span className="font-semibold tabular-nums">{p.v.toFixed(1)}%</span>
      <span className="opacity-70"> · {when}</span>
    </div>
  )
}

interface ChartProps {
  label: string
  points: MetricPoint[]
  color: string
  rangeMinutes: number
  compact?: boolean
}

function MetricChart({ label, points, color, rangeMinutes, compact }: ChartProps) {
  const gid = useId().replace(/:/g, '')
  const last = points[points.length - 1]
  return (
    <div className={compact ? 'h-16' : 'h-48'} role="img" aria-label={`${label} chart, latest ${fmtPct(last?.v ?? null)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={compact ? { top: 4, right: 4, bottom: 0, left: 4 } : { top: 8, right: 12, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {!compact && <CartesianGrid vertical={false} stroke="var(--border)" />}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            hide={compact}
            tickFormatter={(t: number) => fmtTick(t, rangeMinutes)}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            hide={compact}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
            content={(p) => <TooltipBody active={p.active} payload={p.payload as unknown as { payload: MetricPoint }[]} rangeMinutes={rangeMinutes} />}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="v"
            name={label}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gid})`}
            dot={false}
            activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

