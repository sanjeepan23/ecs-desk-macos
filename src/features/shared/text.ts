// Pure text helpers for log lines and terminal titles.

// Matches CSI and OSC escape sequences, plus single-byte C1 forms.
const ANSI_RE = /[\u001b\u009b](?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** Removes ANSI codes, trailing line breaks, and control characters except tab. */
export function cleanLogMessage(s: string): string {
  return stripAnsi(s).replace(/[\r\n]+$/, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

/** Cuts a string to at most `max` code points, so a surrogate pair never splits. */
export function truncate(s: string, max: number): string {
  const cps = Array.from(s)
  if (cps.length <= max) return s
  return cps.slice(0, Math.max(0, max - 1)).join('') + '…'
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface Segment {
  text: string
  match: boolean
}

/** Splits text into plain and matching parts for a case-insensitive highlight. */
export function splitHighlight(text: string, query: string): Segment[] {
  const q = query.trim()
  if (!q) return [{ text, match: false }]
  // The `i` flag keeps string offsets intact. toLowerCase() can change the length of some characters.
  const re = new RegExp(escapeRegExp(q), 'giu')
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    if (start > last) out.push({ text: text.slice(last, start), match: false })
    out.push({ text: m[0], match: true })
    last = start + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), match: false })
  return out.length ? out : [{ text, match: false }]
}

export function includesCI(text: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  return new RegExp(escapeRegExp(q), 'iu').test(text)
}

/** Short task ID: the last ARN segment, first 8 characters. */
export function shortTaskId(arnOrId: string): string {
  const id = arnOrId.split('/').pop() ?? arnOrId
  return id.slice(0, 8)
}

/** "family:rev" from a task definition ARN or short form. */
export function shortTaskDef(td: string): string {
  return td.split('/').pop() ?? td
}

export function parseTaskDef(td: string): { family: string; revision: number | null } {
  const short = shortTaskDef(td)
  const i = short.lastIndexOf(':')
  if (i < 0) return { family: short, revision: null }
  const rev = Number(short.slice(i + 1))
  return { family: short.slice(0, i), revision: Number.isFinite(rev) ? rev : null }
}

export function hms(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour12: false })
}
