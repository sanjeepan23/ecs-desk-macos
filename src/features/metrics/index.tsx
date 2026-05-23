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

