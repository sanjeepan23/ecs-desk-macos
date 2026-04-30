// Typed wrappers for every Tauri command and event.
// In a plain browser (`pnpm dev` without Tauri), calls go to the mock backend in ./mock.

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'

import { mockInvoke, mockListen } from './mock'
import type {
  AppError,
  CallerIdentity,
  ClusterSummary,
  DeployWatch,
  EcsUpdate,
  ExecCheck,
  ExecExit,
  ExecOutput,
  ExecStart,
  FleetEntry,
  Focus,
  LogBatch,
  LogLine,
  LogTarget,
  PollStatus,
  Profile,
  ServiceDetail,
  ServiceMetrics,
  ServiceRef,
  ServiceSummary,
  Settings,
  StoppedAnalysis,
  Task,
  TaskRef,
} from './types'
import { EVENTS } from './types'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri ? tauriInvoke<T>(cmd, args) : mockInvoke<T>(cmd, args ?? {})
}

function listen<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  return isTauri ? tauriListen<T>(event, (e) => cb(e.payload)) : mockListen<T>(event, cb)
}

