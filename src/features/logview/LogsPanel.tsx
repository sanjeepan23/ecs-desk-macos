// Live log tail and search. The public entry is @/features/logs.

import '@fontsource-variable/jetbrains-mono'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Loading03Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, asAppError, events } from '@/lib/api'
import type { LogTarget, ServiceSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

import { hms, shortTaskDef, splitHighlight } from '../shared/text'
import { newId } from '../terminal/store'
import { filterRows, LogBuffer, MAX_LINES, sourceLabel, type Level, type LevelFilter, type Row } from './buffer'

const BACKFILL_MS = 5 * 60_000
const EARLIER_MS = 15 * 60_000
const MONO = "'JetBrains Mono Variable', ui-monospace, Menlo, Consolas, monospace"

const LEVEL_CLASS: Record<Level, string> = {
  DEBUG: 'text-muted-foreground',
  INFO: 'text-blue-600 dark:text-blue-400',
  WARN: 'text-amber-600 dark:text-amber-400',
  ERROR: 'text-red-600 dark:text-red-400',
}

type TailState = 'idle' | 'connecting' | 'live' | 'error'

function targetKey(t: LogTarget) {
  return `${t.group}|${t.streamPrefix ?? ''}|${t.container ?? ''}`
}

/** Resolves log targets for each distinct task definition. */
function useLogTargets(profile: string | null, region: string | null, services: ServiceSummary[]) {
  const tdKey = useMemo(() => [...new Set(services.map((s) => s.taskDefinition))].sort().join('\n'), [services])
  const [state, setState] = useState<{ targets: LogTarget[] | null; error: string | null; warnings: string[] }>({
    targets: null,
    error: null,
    warnings: [],
  })

  useEffect(() => {
    const tds = tdKey ? tdKey.split('\n') : []
    if (!profile || !region || !tds.length) {
      setState({ targets: [], error: null, warnings: [] })
      return
    }
    let live = true
    setState({ targets: null, error: null, warnings: [] })
    Promise.allSettled(tds.map((td) => api.resolveLogTargets(profile, region, td))).then((results) => {
      if (!live) return
      const seen = new Map<string, LogTarget>()
      const problems: string[] = []
      results.forEach((r, i) => {
        const td = shortTaskDef(tds[i])
        if (r.status === 'rejected') problems.push(`${td}: ${asAppError(r.reason).message}`)
        else if (!r.value.length) problems.push(`${td} has no awslogs log configuration.`)
        else r.value.forEach((t) => seen.set(targetKey(t), t))
      })
      const targets = [...seen.values()]
      setState(
        targets.length
          ? { targets, error: null, warnings: problems }
          : {
              targets: [],
              error:
                problems.length === 1
                  ? `${problems[0]} Add the awslogs log driver to the container definitions to see logs here.`
                  : problems.join(' ') || 'No log targets found.',
              warnings: [],
            },
      )
    })
    return () => {
      live = false
    }
  }, [profile, region, tdKey])

  return state
}

