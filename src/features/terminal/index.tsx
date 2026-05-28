// Bottom exec terminal panel with xterm.js.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon, ComputerTerminal01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { attach, disposeSession, fitSession, focusSession, TERM_BG } from './runtime'
import { useTerminal, type TermSession } from './store'

export { useTerminal, sessionTitle, type ExecTarget, type TermSession, type TerminalState } from './store'

const HEIGHT_KEY = 'ecs-desk.terminal-height'
const MIN_H = 140

function readHeight(): number {
  try {
    const v = Number(localStorage.getItem(HEIGHT_KEY))
    if (v >= MIN_H) return v
  } catch {
    // Storage can be blocked. Use the default height.
  }
  return 280
}

/** Stops the backend session and removes the tab. */
export function closeSession(id: string) {
  disposeSession(id)
  useTerminal.getState().removeSession(id)
}

function TerminalHost({ session, active }: { session: TermSession; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    attach(session, el)
    const ro = new ResizeObserver(() => fitSession(session.id))
    ro.observe(el)
    return () => ro.disconnect()
    // The session object changes on status updates. Attach only once per session ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      fitSession(session.id)
      focusSession(session.id)
    })
    return () => cancelAnimationFrame(raf)
  }, [active, session.id])

  return <div ref={ref} className={cn('absolute inset-0 px-3 py-2', !active && 'invisible')} aria-hidden={!active} />
}

function StatusDot({ status }: { status: TermSession['status'] }) {
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'open' && 'bg-emerald-500',
        status === 'connecting' && 'animate-pulse bg-amber-500',
        status === 'ended' && 'bg-muted-foreground/50',
      )}
      aria-label={status}
    />
  )
}

/** Rendered by the shell under the main content. Returns null when closed. */
export function TerminalPanel() {
  const { open, sessions, activeId, setActive, close, toggle } = useTerminal()
  const [height, setHeight] = useState(readHeight)
  const active = sessions.find((s) => s.id === activeId) ?? null

  // Ctrl+` toggles the panel. Another handler can claim the key first with preventDefault().
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.ctrlKey || e.key !== '`') return
      e.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    let last = startH
    const move = (ev: PointerEvent) => {
      last = Math.max(MIN_H, Math.min(window.innerHeight * 0.8, startH + (startY - ev.clientY)))
      setHeight(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      try {
        localStorage.setItem(HEIGHT_KEY, String(Math.round(last)))
      } catch {
        // Storage can be blocked. The height then resets on the next start.
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!open) return null

  return (
    <section
      className="relative flex shrink-0 flex-col border-t bg-background"
      style={{ height }}
      aria-label="Terminal"
    >
      <div
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
        onPointerDown={onDragStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
      />
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
          {sessions.length === 0 && (
            <span className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
              <HugeiconsIcon icon={ComputerTerminal01Icon} className="size-4" />
              Terminal
            </span>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              role="tab"
              aria-selected={s.id === activeId}
              className={cn(
                'group flex h-7 max-w-80 shrink-0 items-center gap-2 rounded-lg pr-1 pl-2.5 font-mono text-xs',
                s.id === activeId ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
              )}
            >
              <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => setActive(s.id)} title={s.title}>
                <StatusDot status={s.status} />
                <span className="truncate">{s.title}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="size-5 rounded-md opacity-70 hover:opacity-100"
                onClick={() => closeSession(s.id)}
                aria-label={`Close ${s.title}`}
              >
                <HugeiconsIcon icon={Cancel01Icon} className="size-3" />
              </Button>
            </div>
          ))}
        </div>
        {active && (
          <span className="hidden shrink-0 text-xs whitespace-nowrap text-muted-foreground sm:inline">
            {active.profile} · {active.region}
            {active.status === 'ended' && ` · exit ${active.exitCode ?? 'unknown'}`}
          </span>
        )}
        <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close terminal panel">
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1" style={{ background: TERM_BG() }}>
        {sessions.map((s) => (
          <TerminalHost key={s.id} session={s} active={s.id === activeId} />
        ))}
        {sessions.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-sm text-neutral-400">
            <HugeiconsIcon icon={ComputerTerminal01Icon} className="mb-1 size-6 text-neutral-500" />
            <p className="font-medium text-neutral-200">No exec session</p>
            <p>
              To start one, open the menu on a task row and select <span className="font-medium text-neutral-200">Exec</span>.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
