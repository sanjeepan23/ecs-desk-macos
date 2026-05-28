import { create } from 'zustand'

import { shortTaskId } from '../shared/text'

export interface ExecTarget {
  profile: string
  region: string
  cluster: string
  taskArn: string
  service: string | null
  container: string
  command?: string | null
}

export type SessionStatus = 'connecting' | 'open' | 'ended'

export interface TermSession extends ExecTarget {
  id: string
  title: string
  status: SessionStatus
  exitCode: number | null
}

export interface TerminalState {
  open: boolean
  sessions: TermSession[]
  activeId: string | null
  toggle: () => void
  close: () => void
  show: () => void
  /** Adds a session tab, opens the panel, and returns the session ID. */
  openExec: (target: ExecTarget) => string
  setActive: (id: string) => void
  setStatus: (id: string, status: SessionStatus, exitCode?: number | null) => void
  /** Removes the tab. The panel stops the backend session. */
  removeSession: (id: string) => void
}

export function sessionTitle(t: ExecTarget): string {
  return `${t.service ?? t.cluster}/${shortTaskId(t.taskArn)} · ${t.container}`
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

