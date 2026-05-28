// Keeps one xterm.js instance per exec session outside React.
// The panel can unmount and mount again without loss of the scrollback or the backend session.

import '@fontsource-variable/jetbrains-mono'
import '@xterm/xterm/css/xterm.css'

import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'

import { api, asAppError, events } from '@/lib/api'

import { useTerminal, type TermSession } from './store'

export const MONO_FONT = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"

interface Runtime {
  term: Terminal
  fit: FitAddon
  started: boolean
  ended: boolean
  cols: number
  rows: number
}

const runtimes = new Map<string, Runtime>()
let listeners: Promise<void> | null = null

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/** A dark theme in both app themes. The shell can override the colors with --term-* CSS variables. */
function theme(): ITheme {
  return {
    background: cssVar('--term-bg', '#0d0e12'),
    foreground: cssVar('--term-fg', '#d7dae0'),
    cursor: cssVar('--term-ok', '#6fd28f'),
    cursorAccent: '#0d0e12',
    selectionBackground: '#3a4a6a',
    black: '#1b1d23',
    red: '#f06a6a',
    green: '#6fd28f',
    yellow: '#f0b35c',
    blue: '#6d9cff',
    magenta: '#c792ea',
    cyan: '#5fc6d0',
    white: '#d7dae0',
    brightBlack: '#7d8590',
    brightRed: '#ff8a8a',
    brightGreen: '#8de3a8',
    brightYellow: '#ffd27f',
    brightBlue: '#94b8ff',
    brightMagenta: '#ddb2f5',
    brightCyan: '#8ee0e8',
    brightWhite: '#ffffff',
  }
}

export const TERM_BG = () => theme().background ?? '#0d0e12'

function ensureListeners(): Promise<void> {
  if (!listeners) {
    listeners = Promise.all([
      events.onExecOutput((o) => runtimes.get(o.sessionId)?.term.write(o.data)),
      events.onExecExit((e) => markEnded(e.sessionId, e.code)),
    ]).then(() => undefined)
  }
  return listeners
}

function markEnded(id: string, code: number | null) {
  const rt = runtimes.get(id)
  if (!rt || rt.ended) return
  rt.ended = true
  rt.term.write(`\r\n\x1b[90m[session ended, exit code ${code ?? 'unknown'}]\x1b[0m\r\n`)
  useTerminal.getState().setStatus(id, 'ended', code)
}

/** Shows the session terminal inside `el`. The first call also starts the backend session. */
export function attach(s: TermSession, el: HTMLElement): void {
  const existing = runtimes.get(s.id)
  if (existing) {
    const node = existing.term.element
    if (node && node.parentElement !== el) el.appendChild(node)
    fitSession(s.id)
    existing.term.refresh(0, existing.term.rows - 1)
    return
  }

  const term = new Terminal({
    fontFamily: MONO_FONT,
    fontSize: 12.5,
    lineHeight: 1.25,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: false,
    theme: theme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  const rt: Runtime = { term, fit, started: false, ended: false, cols: 0, rows: 0 }
  runtimes.set(s.id, rt)
  term.open(el)
  safeFit(rt)

  // xterm measures the font when it opens. Measure again when the web font is ready.
  document.fonts?.load(`12.5px 'JetBrains Mono Variable'`).then(() => {
    if (!runtimes.has(s.id)) return
    term.options.fontFamily = MONO_FONT
    fitSession(s.id)
  })

  term.onData((d) => {
    if (!rt.started || rt.ended) return
    api.execWrite(s.id, d).catch(() => {})
  })

  void (async () => {
    await ensureListeners()
    try {
      await api.execStart({
        sessionId: s.id,
        profile: s.profile,
        region: s.region,
        cluster: s.cluster,
        taskArn: s.taskArn,
        container: s.container,
        command: s.command ?? null,
        cols: term.cols,
        rows: term.rows,
      })
      if (!runtimes.has(s.id)) {
        // The user closed the tab while the session started.
        api.execStop(s.id).catch(() => {})
        return
      }
      rt.started = true
      rt.cols = term.cols
      rt.rows = term.rows
      useTerminal.getState().setStatus(s.id, 'open')
      term.focus()
    } catch (e) {
      const err = asAppError(e)
      term.write(`\x1b[31mCould not start the exec session: ${err.message}\x1b[0m\r\n`)
      rt.ended = true
      useTerminal.getState().setStatus(s.id, 'ended', null)
    }
  })()
}

