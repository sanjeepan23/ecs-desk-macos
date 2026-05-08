// Global app state.

import { toast } from 'sonner'
import { create } from 'zustand'

import { api } from '@/lib/api'
import { reportError } from '@/lib/errors'
import { formatAccount } from '@/lib/format'
import type {
  AppError,
  ClusterSummary,
  EcsUpdate,
  Focus,
  PollStatus,
  Profile,
  ServiceDetail,
  ServiceEvent,
  ServiceSummary,
  Settings,
  Task,
} from '@/lib/types'

import { focusFor, mergeUpdate, sameFocus } from './merge'

export type View =
  | { name: 'overview' }
  | { name: 'clusters' }
  | { name: 'cluster'; cluster: string }
  | { name: 'services' }
  | { name: 'service'; cluster: string; service: string; tab?: ServiceTab; taskState?: 'RUNNING' | 'STOPPED' }
  | { name: 'tasks' }
  | { name: 'task'; cluster: string; service: string | null; taskArn: string }
  | { name: 'logs' }
  | { name: 'events' }
  | { name: 'settings' }
  | { name: 'fleet' }

export type ServiceTab = 'overview' | 'tasks' | 'deployments' | 'events' | 'logs' | 'metrics' | 'config'

export interface AppState {
  profiles: Profile[]
  settings: Settings | null
  profile: string | null
  region: string | null
  view: View
  clusters: ClusterSummary[]
  /** Services of every cluster in the current profile and region. */
  services: ServiceSummary[]
  serviceDetail: ServiceDetail | null
  tasks: Task[]
  pollStatus: PollStatus | null

  /** True after settings and profiles load. */
  ready: boolean
  bootError: AppError | null
  /** Last error of the cluster and service load for the current profile and region. */
  scopeError: AppError | null
  loadingScope: boolean
  /** Time of the last poller update for the current profile and region. Unix ms. */
  polledAt: number | null
  focus: Focus | null
  /** Profiles whose SSO session expired. */
  authExpired: Record<string, boolean>
  /** Service events by "cluster/service". The poller sends events of the focused service only. */
  events: Record<string, ServiceEvent[]>
  eventsLoadedAt: number | null

  navigate: (view: View) => void
  setProfile: (profile: string) => Promise<void>
  setRegion: (region: string) => Promise<void>
  refresh: () => Promise<void>

  init: () => Promise<void>
  applyUpdate: (u: EcsUpdate) => void
  setPollStatus: (s: PollStatus) => void
  loadScope: () => Promise<void>
  loadAllEvents: (force?: boolean) => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  setReadOnly: (profile: string, value: boolean) => Promise<void>
  login: (profile?: string) => Promise<void>
  /** Shows a toast for the error. Auth errors also get a "Log in" button. */
  report: (e: unknown) => AppError
}

