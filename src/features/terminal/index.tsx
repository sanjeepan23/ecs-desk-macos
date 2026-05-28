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

