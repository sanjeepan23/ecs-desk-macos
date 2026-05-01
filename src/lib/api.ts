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

export function asAppError(e: unknown): AppError {
  if (e && typeof e === 'object' && 'kind' in e && 'message' in e) return e as AppError
  return { kind: 'internal', message: e instanceof Error ? e.message : String(e) }
}

export const api = {
  // Settings and profiles
  getSettings: () => invoke<Settings>('get_settings'),
  updateSettings: (settings: Settings) => invoke<Settings>('update_settings', { settings }),
  listProfiles: () => invoke<Profile[]>('list_profiles'),
  setReadOnly: (profile: string, value: boolean) => invoke<Profile>('set_read_only', { profile, value }),
  ssoLogin: (profile: string) => invoke<void>('sso_login', { profile }),
  whoami: (profile: string, region: string) => invoke<CallerIdentity>('whoami', { profile, region }),

  // ECS reads
  listClusters: (profile: string, region: string) => invoke<ClusterSummary[]>('list_clusters', { profile, region }),
  listServices: (profile: string, region: string, cluster: string) =>
    invoke<ServiceSummary[]>('list_services', { profile, region, cluster }),
  getService: (profile: string, region: string, cluster: string, service: string) =>
    invoke<ServiceDetail>('get_service', { profile, region, cluster, service }),
  listTasks: (profile: string, region: string, cluster: string, service: string | null, desiredStatus: 'RUNNING' | 'STOPPED') =>
    invoke<Task[]>('list_tasks', { profile, region, cluster, service, desiredStatus }),
  getTask: (profile: string, region: string, cluster: string, taskArn: string) =>
    invoke<Task>('get_task', { profile, region, cluster, taskArn }),
  getTaskDefinition: (profile: string, region: string, taskDefinition: string) =>
    invoke<Record<string, unknown>>('get_task_definition', { profile, region, taskDefinition }),
  listTaskDefinitionRevisions: (profile: string, region: string, family: string) =>
    invoke<string[]>('list_task_definition_revisions', { profile, region, family }),

  // Polling
  setFocus: (focus: Focus) => invoke<void>('set_focus', { focus }),
  pollStatus: () => invoke<PollStatus>('poll_status'),
  refreshNow: () => invoke<void>('refresh_now'),

  // Actions
  forceDeploy: (target: ServiceRef) => invoke<ServiceSummary>('force_deploy', { target }),
  scaleService: (target: ServiceRef, desired: number) => invoke<ServiceSummary>('scale_service', { target, desired }),
  rollbackService: (target: ServiceRef, taskDefinition: string) =>
    invoke<ServiceSummary>('rollback_service', { target, taskDefinition }),
  stopTask: (target: TaskRef, reason?: string) => invoke<Task>('stop_task', { target, reason: reason ?? null }),

  // Logs
  resolveLogTargets: (profile: string, region: string, taskDefinition: string) =>
    invoke<LogTarget[]>('resolve_log_targets', { profile, region, taskDefinition }),
  startLogTail: (sessionId: string, profile: string, region: string, targets: LogTarget[], filter?: string) =>
    invoke<void>('start_log_tail', { sessionId, profile, region, targets, filter: filter ?? null }),
  stopLogTail: (sessionId: string) => invoke<void>('stop_log_tail', { sessionId }),
  searchLogs: (profile: string, region: string, targets: LogTarget[], filter: string | null, startMs: number, endMs: number, limit?: number) =>
    invoke<LogLine[]>('search_logs', { profile, region, targets, filter, startMs, endMs, limit: limit ?? null }),

  // Metrics
  getMetrics: (profile: string, region: string, cluster: string, service: string, rangeMinutes: number) =>
    invoke<ServiceMetrics>('get_metrics', { profile, region, cluster, service, rangeMinutes }),

  // Exec
  execCheck: (profile: string, region: string, cluster: string, taskArn: string, container: string) =>
    invoke<ExecCheck>('exec_check', { profile, region, cluster, taskArn, container }),
  execStart: (req: ExecStart) => invoke<void>('exec_start', { req }),
  execWrite: (sessionId: string, data: string) => invoke<void>('exec_write', { sessionId, data }),
  execResize: (sessionId: string, cols: number, rows: number) => invoke<void>('exec_resize', { sessionId, cols, rows }),
  execStop: (sessionId: string) => invoke<void>('exec_stop', { sessionId }),

  // Stopped-task analysis
  analyzeStoppedTasks: (profile: string, region: string, cluster: string, service: string) =>
    invoke<StoppedAnalysis>('analyze_stopped_tasks', { profile, region, cluster, service }),

  // Deployment watch
  watchDeployment: (target: ServiceRef) => invoke<DeployWatch>('watch_deployment', { target }),
  listWatches: () => invoke<DeployWatch[]>('list_watches'),
  unwatch: (id: string) => invoke<void>('unwatch', { id }),

  // Fleet
  fleetScan: (profiles?: string[]) => invoke<FleetEntry[]>('fleet_scan', { profiles: profiles ?? null }),
  fleetSnapshot: () => invoke<FleetEntry[]>('fleet_snapshot'),
}

export const events = {
  onEcsUpdate: (cb: (u: EcsUpdate) => void) => listen<EcsUpdate>(EVENTS.ecsUpdate, cb),
  onPollStatus: (cb: (s: PollStatus) => void) => listen<PollStatus>(EVENTS.pollStatus, cb),
  onLogLines: (cb: (b: LogBatch) => void) => listen<LogBatch>(EVENTS.logLines, cb),
  onExecOutput: (cb: (o: ExecOutput) => void) => listen<ExecOutput>(EVENTS.execOutput, cb),
  onExecExit: (cb: (e: ExecExit) => void) => listen<ExecExit>(EVENTS.execExit, cb),
  onProfilesChanged: (cb: () => void) => listen<null>(EVENTS.profilesChanged, () => cb()),
  onDeployWatch: (cb: (w: DeployWatch) => void) => listen<DeployWatch>(EVENTS.deployWatch, cb),
  onFleetEntry: (cb: (e: FleetEntry) => void) => listen<FleetEntry>(EVENTS.fleetEntry, cb),
}
