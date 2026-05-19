// Pure log buffer and filter logic for the logs panel.

import type { LogLine } from '@/lib/types'

import { cleanLogMessage, includesCI } from '../shared/text'

export type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type LevelFilter = 'all' | 'INFO' | 'WARN' | 'ERROR'

export interface Row {
  id: number
  timestamp: number
  level: Level
  message: string
  group: string
  stream: string
}

export const MAX_LINES = 5000

export function normalizeLevel(raw: string | null | undefined, message = ''): Level {
  const s = (raw ?? '').toUpperCase()
  if (s.startsWith('ERR') || s === 'FATAL' || s === 'CRITICAL' || s === 'SEVERE') return 'ERROR'
  if (s.startsWith('WARN')) return 'WARN'
  if (s === 'DEBUG' || s === 'TRACE') return 'DEBUG'
  if (s === 'INFO') return 'INFO'
  // The backend can send an unknown level. Then look for a level word in the message.
  const m = /\b(ERROR|FATAL|WARN(?:ING)?|DEBUG|TRACE)\b/i.exec(message)
  return m ? normalizeLevel(m[1]) : 'INFO'
}

/** Keeps the newest `cap` rows. Rows stay in time order when the input is in time order. */
export class LogBuffer {
  private rows: Row[] = []
  private seq = 0
  readonly cap: number

  constructor(cap = MAX_LINES) {
    this.cap = cap
  }

  private toRow(l: LogLine): Row {
    const message = cleanLogMessage(l.message)
    return {
      id: ++this.seq,
      timestamp: l.timestamp,
      level: normalizeLevel(l.level, message),
      message,
      group: l.group,
      stream: l.stream,
    }
  }

  append(lines: LogLine[]): void {
    if (!lines.length) return
    this.rows.push(...lines.map((l) => this.toRow(l)))
    if (this.rows.length > this.cap) this.rows.splice(0, this.rows.length - this.cap)
  }

  /** Adds older rows at the start. Returns the number of rows that it kept. */
  prepend(lines: LogLine[]): number {
    const room = this.cap - this.rows.length
    if (room <= 0 || !lines.length) return 0
    const kept = lines.slice(-room).map((l) => this.toRow(l))
    this.rows.unshift(...kept)
    return kept.length
  }

  clear(): void {
    this.rows = []
  }

  get size(): number {
    return this.rows.length
  }

  get oldest(): number | null {
    return this.rows.length ? this.rows[0].timestamp : null
  }

  snapshot(): Row[] {
    return this.rows.slice()
  }
}

export function filterRows(rows: Row[], level: LevelFilter, query: string): Row[] {
  const q = query.trim()
  if (level === 'all' && !q) return rows
  return rows.filter((r) => (level === 'all' || r.level === level) && (!q || includesCI(r.message, q)))
}

/** Short source label from a stream name such as "ecs/web/0123abcd...". */
export function sourceLabel(stream: string): string {
  const parts = stream.split('/').filter(Boolean)
  if (parts.length >= 3) return `${parts[parts.length - 2]}/${parts[parts.length - 1].slice(0, 8)}`
  if (parts.length === 2) return `${parts[0]}/${parts[1].slice(0, 8)}`
  return stream
}
