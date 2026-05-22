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

const LogRow = memo(function LogRow({ row, query }: { row: Row; query: string }) {
  return (
    <>
      <span className="text-muted-foreground tabular-nums">{hms(row.timestamp)}</span>
      <span className={LEVEL_CLASS[row.level]}>{row.level}</span>
      <span className="hidden truncate text-muted-foreground md:block" title={`${row.group} · ${row.stream}`}>
        {sourceLabel(row.stream)}
      </span>
      <span className="min-w-0 break-words whitespace-pre-wrap">
        {splitHighlight(row.message, query).map((seg, i) =>
          seg.match ? (
            <mark key={i} className="rounded-sm bg-amber-200/70 text-inherit dark:bg-amber-500/30">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </span>
    </>
  )
})

/** Shows logs for the given services. One service on the service page; many on the Logs page. */
export function LogsPanel({ services }: { services: ServiceSummary[] }) {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const { targets, error: resolveError, warnings } = useLogTargets(profile, region, services)
  const targetsKey = useMemo(() => (targets ?? []).map(targetKey).sort().join(','), [targets])

  const [query, setQuery] = useState('')
  const [serverFilter, setServerFilter] = useState('')
  const [level, setLevel] = useState<LevelFilter>('all')
  const [paused, setPaused] = useState(false)
  const [tail, setTail] = useState<{ state: TailState; error: string | null }>({ state: 'idle', error: null })
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [atBottom, setAtBottom] = useState(true)

  const bufRef = useRef(new LogBuffer(MAX_LINES))
  const [version, setVersion] = useState(0)
  const frozenRef = useRef<Row[] | null>(null)
  const [newWhilePaused, setNewWhilePaused] = useState(0)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // Batch renders to one per animation frame. A busy service can send many lines per second.
  const rafRef = useRef(0)
  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      setVersion((v) => v + 1)
    })
  }, [])
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // One live tail session per set of inputs.
  useEffect(() => {
    if (!profile || !region || !targets || !targets.length) {
      setTail({ state: 'idle', error: null })
      return
    }
    const buf = bufRef.current
    buf.clear()
    frozenRef.current = pausedRef.current ? [] : null
    setNewWhilePaused(0)
    setVersion((v) => v + 1)
    const sessionId = `logs-${newId()}`
    const filter = serverFilter.trim() || undefined
    let live = true
    setTail({ state: 'connecting', error: null })

    const unlisten = events.onLogLines((b) => {
      if (!live || b.sessionId !== sessionId || !b.lines.length) return
      buf.append(b.lines)
      if (pausedRef.current) setNewWhilePaused((n) => n + b.lines.length)
      scheduleFlush()
    })

    const now = Date.now()
    api
      .searchLogs(profile, region, targets, filter ?? null, now - BACKFILL_MS, now, 500)
      .then((lines) => {
        if (!live) return
        buf.prepend(lines)
        if (pausedRef.current) frozenRef.current = buf.snapshot()
        scheduleFlush()
      })
      .catch(() => {
        // The live tail can still work without the backfill.
      })

    unlisten
      .then(() => api.startLogTail(sessionId, profile, region, targets, filter))
      .then(() => live && setTail({ state: 'live', error: null }))
      .catch((e) => live && setTail({ state: 'error', error: asAppError(e).message }))

    return () => {
      live = false
      unlisten.then((f) => f()).catch(() => {})
      api.stopLogTail(sessionId).catch(() => {})
    }
    // targetsKey stands for targets. A new array with the same targets must not restart the tail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, region, targetsKey, serverFilter, scheduleFlush])

  const togglePause = () => {
    if (paused) {
      frozenRef.current = null
      setNewWhilePaused(0)
      setPaused(false)
      setAtBottom(true)
    } else {
      frozenRef.current = bufRef.current.snapshot()
      setPaused(true)
    }
    setVersion((v) => v + 1)
  }

  // `version` is the signal that the buffer changed.
  const rows = useMemo(
    () => frozenRef.current ?? bufRef.current.snapshot(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, paused],
  )
  const display = useMemo(() => filterRows(rows, level, query), [rows, level, query])

  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)

  const virtualizer = useVirtualizer({
    count: display.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 24,
    getItemKey: (i) => display[i].id,
  })

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    atBottomRef.current = bottom
    if (bottom !== atBottom) setAtBottom(bottom)
  }

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current
    if (!el || !display.length) return
    virtualizer.scrollToIndex(display.length - 1, { align: 'end' })
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [display.length, virtualizer])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (anchorRef.current) {
      // Keep the same lines in view after older lines load above them.
      const a = anchorRef.current
      anchorRef.current = null
      el.scrollTop = a.top + (el.scrollHeight - a.height)
      return
    }
    if (atBottomRef.current) scrollToEnd()
  }, [display, scrollToEnd])

  const loadEarlier = async () => {
    if (!profile || !region || !targets?.length || loadingEarlier) return
    const buf = bufRef.current
    if (buf.size >= buf.cap) {
      toast.info(`The view holds ${MAX_LINES.toLocaleString()} lines at most.`, {
        description: 'Use a filter pattern to see older lines.',
      })
      return
    }
    const end = (buf.oldest ?? Date.now()) - 1
    setLoadingEarlier(true)
    try {
      const lines = await api.searchLogs(profile, region, targets, serverFilter.trim() || null, end - EARLIER_MS, end, 1000)
      if (!lines.length) {
        toast.info(`No log lines in the 15 minutes before ${hms(end)}.`)
        return
      }
      const el = scrollRef.current
      if (el) anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      atBottomRef.current = false
      buf.prepend(lines)
      if (frozenRef.current) frozenRef.current = buf.snapshot()
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error('Could not load earlier lines', { description: asAppError(e).message })
    } finally {
      setLoadingEarlier(false)
    }
  }

  const groups = useMemo(() => [...new Set((targets ?? []).map((t) => t.group))], [targets])
  const groupLabel = groups.length === 0 ? null : groups.length === 1 ? groups[0] : `${groups[0]} +${groups.length - 1}`

  const status = (() => {
    if (resolveError || tail.state === 'error') return <Badge variant="destructive">Error</Badge>
    if (targets == null || tail.state === 'connecting')
      return (
        <Badge variant="secondary" className="gap-1">
          <HugeiconsIcon icon={Loading03Icon} className="animate-spin" /> Connecting
        </Badge>
      )
    if (paused)
      return <Badge variant="secondary">Paused{newWhilePaused ? ` · ${newWhilePaused.toLocaleString()} new` : ''}</Badge>
    if (tail.state === 'live')
      return (
        <Badge className="gap-1.5 bg-emerald-600/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
          <span className="size-1.5 animate-pulse rounded-full bg-current" /> Live tail
        </Badge>
      )
    return null
  })()

  const blockingError = resolveError ?? (tail.state === 'error' ? `Could not start the live tail: ${tail.error}` : null)

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <HugeiconsIcon icon={Search01Icon} className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setServerFilter(query.trim())
              if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search lines. Enter filters on AWS."
            aria-label="Search log lines"
            className="h-8 pl-9"
          />
        </div>
        <ToggleGroup
          type="single"
          value={level}
          onValueChange={(v) => v && setLevel(v as LevelFilter)}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Log level"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="INFO">Info</ToggleGroupItem>
          <ToggleGroupItem value="WARN">Warn</ToggleGroupItem>
          <ToggleGroupItem value="ERROR">Error</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="outline" size="sm" onClick={togglePause} disabled={!!blockingError}>
          <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} />
          {paused ? 'Resume' : 'Pause'}
        </Button>
        <Button variant="outline" size="sm" onClick={loadEarlier} disabled={!targets?.length || loadingEarlier || !!blockingError}>
          <HugeiconsIcon icon={loadingEarlier ? Loading03Icon : ArrowUp01Icon} className={cn(loadingEarlier && 'animate-spin')} />
          Load earlier
        </Button>
        <div className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {status}
          {groupLabel && (
            <span className="truncate font-mono" title={groups.join('\n')}>
              {groupLabel}
            </span>
          )}
        </div>
      </div>

      {serverFilter && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filter pattern on AWS:</span>
          <span className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 font-mono text-foreground">
            {serverFilter}
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-background"
              onClick={() => setServerFilter('')}
              aria-label="Clear filter pattern"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
            </button>
          </span>
        </div>
      )}

      {warnings.length > 0 && !blockingError && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Some services have no logs here: {warnings.join(' ')}</p>
      )}

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[clamp(320px,calc(100vh-320px),900px)] overflow-auto rounded-2xl border bg-card py-2 text-xs leading-5"
          style={{ fontFamily: MONO }}
          role="log"
          aria-live="off"
        >
          {blockingError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center font-sans text-sm">
              <HugeiconsIcon icon={AlertCircleIcon} className="size-6 text-destructive" />
              <p className="max-w-lg text-muted-foreground">{blockingError}</p>
            </div>
          ) : services.length === 0 ? (
            <Empty>No services to show logs for.</Empty>
          ) : display.length === 0 ? (
            <Empty>
              {rows.length
                ? 'No log lines match this filter.'
                : targets == null || tail.state === 'connecting'
                  ? 'Connecting to CloudWatch Logs.'
                  : 'Waiting for log lines.'}
            </Empty>
          ) : (
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((vi) => (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 grid w-full grid-cols-[64px_44px_minmax(0,1fr)] gap-x-3 px-4 hover:bg-muted/60 md:grid-cols-[64px_44px_180px_minmax(0,1fr)]"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  <LogRow row={display[vi.index]} query={query} />
                </div>
              ))}
            </div>
          )}
        </div>
        {!atBottom && display.length > 0 && (
          <Button size="sm" variant="secondary" className="absolute right-4 bottom-3 shadow-md" onClick={() => {
            atBottomRef.current = true
            setAtBottom(true)
            scrollToEnd()
          }}>
            <HugeiconsIcon icon={ArrowDown01Icon} />
            Latest
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {display.length.toLocaleString()} of {rows.length.toLocaleString()} lines shown. The view keeps the last {MAX_LINES.toLocaleString()} lines.
      </p>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center px-6 text-center font-sans text-sm text-muted-foreground">{children}</div>
}
