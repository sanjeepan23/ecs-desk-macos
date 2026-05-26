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

