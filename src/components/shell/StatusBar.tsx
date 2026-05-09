import { useEffect, useRef, useState } from 'react'
import { Alert02Icon, ComputerTerminal01Icon } from '@hugeicons/core-free-icons'

import { usePalette } from '@/features/palette'
import { RolloutsIndicator } from '@/features/deploywatch'
import { useTerminal } from '@/features/terminal'
import { useNow } from '@/hooks/useNow'
import { connectionMeta } from '@/lib/status'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'
import { Icon, StatusDot } from '@/views/parts/ui'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function StatusBar() {
  const now = useNow(1000)
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const poll = useApp((s) => s.pollStatus)
  const storePolled = useApp((s) => s.polledAt)
  const every = useApp((s) => s.settings?.pollFocusedSecs)
  const expired = useApp((s) => (s.profile ? !!s.authExpired[s.profile] : false))
  const toggleTerm = useTerminal((s) => s.toggle)
  const setPalette = usePalette((s) => s.setOpen)

  const polledAt = poll?.polledAt ?? storePolled
  const conn = connectionMeta(poll ? { ...poll, polledAt } : polledAt ? { polledAt, throttled: false, lastError: null } : null, expired)

  // The dot flashes once on each new poll.
  const [flash, setFlash] = useState(false)
  const last = useRef(polledAt)
  useEffect(() => {
    if (polledAt && polledAt !== last.current) {
      last.current = polledAt
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 600)
      return () => clearTimeout(t)
    }
  }, [polledAt])

  const btn = 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <footer className="flex h-7 items-center gap-4 overflow-hidden border-t bg-sidebar px-3 text-xs whitespace-nowrap text-muted-foreground">
      <span className="inline-flex items-center gap-1.5" title={poll?.lastError ?? undefined}>
        <StatusDot tone={conn.tone} className={cn(flash && 'animate-ping-once')} />
        {conn.label}
      </span>
      {profile && (
        <span className="hidden md:inline">
          {profile} · <span className="font-mono">{region}</span>
        </span>
      )}
      <span className="num">
        {polledAt ? `Polled ${Math.max(0, Math.round((now - polledAt) / 1000))} s ago` : 'Not polled yet'}
        {every ? ` · every ${every} s` : ''}
      </span>
      {poll && (
        <span className="num hidden md:inline">
          {poll.apiCallsPerMin} API calls/min · rate budget {poll.budgetPct}%
        </span>
      )}
      {poll?.throttled && (
        <span className="inline-flex items-center gap-1 font-medium text-warn">
          <Icon icon={Alert02Icon} size={13} />
          AWS throttles requests. Polling is slower.
        </span>
      )}
      <span className="flex-1" />
      <RolloutsIndicator />
      <button type="button" className={btn} onClick={toggleTerm}>
        <Icon icon={ComputerTerminal01Icon} size={14} />
        Terminal
      </button>
      <button type="button" className={cn(btn, 'hidden md:inline-flex')} onClick={() => setPalette(true)} aria-label="Open command palette">
        <kbd className="rounded-md border bg-background px-1.5 font-mono text-[11px]">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
    </footer>
  )
}
