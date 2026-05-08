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

export const eventKey = (cluster: string, service: string) => `${cluster}/${service}`

const EMPTY_SCOPE = {
  clusters: [] as ClusterSummary[],
  services: [] as ServiceSummary[],
  serviceDetail: null,
  tasks: [] as Task[],
  events: {} as Record<string, ServiceEvent[]>,
  eventsLoadedAt: null,
  polledAt: null,
  scopeError: null,
  focus: null,
}

/** Region to open for a profile: the last region if the profile has it, else its default. */
export function pickRegion(p: Profile, lastRegion: string | null): string | null {
  if (lastRegion && p.regions.includes(lastRegion)) return lastRegion
  if (p.region && p.regions.includes(p.region)) return p.region
  return p.regions[0] ?? p.region ?? null
}

/** Runs `fn` on each item with at most `limit` calls at the same time. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0
  const worker = async () => {
    while (i < items.length) await fn(items[i++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** True when a poller error text means that the AWS session expired. */
export function isAuthText(s: string): boolean {
  return /expired|sso session|token|credentials|log ?in/i.test(s)
}

let initStarted = false

export const useApp = create<AppState>((set, get) => {
  const report = (e: unknown) => {
    const profile = get().profile
    const err = reportError(e, { profile, onLogin: () => void get().login(profile ?? undefined) })
    if (err.kind === 'auth' && profile) set((s) => ({ authExpired: { ...s.authExpired, [profile]: true } }))
    return err
  }

  /** Tells the poller what the user looks at, and loads the focused service now. */
  const syncFocus = () => {
    const { profile, region, view, focus: prev } = get()
    const f = focusFor(profile, region, view)
    if (sameFocus(f, prev)) return
    const serviceChanged = prev?.cluster !== f?.cluster || prev?.service !== f?.service
    set(serviceChanged ? { focus: f, serviceDetail: null, tasks: [] } : { focus: f })
    if (!f) return
    api.setFocus(f).catch(report)
    if (f.cluster && f.service && serviceChanged) {
      const still = () => sameFocus(get().focus, f)
      api
        .getService(f.profile, f.region, f.cluster, f.service)
        .then((d) => {
          if (!still()) return
          set((s) => ({ serviceDetail: d, events: { ...s.events, [eventKey(f.cluster!, f.service!)]: d.events } }))
        })
        .catch(report)
      api
        .listTasks(f.profile, f.region, f.cluster, f.service, 'RUNNING')
        .then((t) => still() && set({ tasks: t }))
        .catch(report)
    }
  }

  const persistScope = () => {
    const { settings, profile, region } = get()
    if (!settings || (settings.lastProfile === profile && settings.lastRegion === region)) return
    void get().saveSettings({ lastProfile: profile, lastRegion: region })
  }

  const activate = async (profile: string, region: string | null) => {
    set({ profile, region, view: { name: 'overview' }, ...EMPTY_SCOPE })
    persistScope()
    syncFocus()
    await get().loadScope()
  }

  return {
    profiles: [],
    settings: null,
    profile: null,
    region: null,
    view: { name: 'overview' },
    clusters: [],
    services: [],
    serviceDetail: null,
    tasks: [],
    pollStatus: null,

    ready: false,
    bootError: null,
    scopeError: null,
    loadingScope: false,
    polledAt: null,
    focus: null,
    authExpired: {},
    events: {},
    eventsLoadedAt: null,

    navigate: (view) => {
      set({ view })
      syncFocus()
    },

    setProfile: async (name) => {
      const p = get().profiles.find((x) => x.name === name)
      if (!p) return
      if (name === get().profile) return
      await activate(name, pickRegion(p, null))
      toast.info(`Switched to ${name}`, { description: `Account ${formatAccount(p.accountId)}` })
    },

    setRegion: async (region) => {
      const { profile } = get()
      if (!profile || region === get().region) return
      await activate(profile, region)
    },

    refresh: async () => {
      await Promise.all([get().loadScope(), api.refreshNow().catch(report)])
      if (!get().scopeError) {
        toast.success('Refreshed', { description: `${get().services.length} services in ${get().region}.` })
      }
    },

    init: async () => {
      if (initStarted) return
      initStarted = true
      try {
        const [settings, profiles] = await Promise.all([api.getSettings(), api.listProfiles()])
        set({ settings, profiles })
        const p = profiles.find((x) => x.name === settings.lastProfile) ?? profiles[0]
        set({ ready: true })
        if (p) await activate(p.name, pickRegion(p, settings.lastProfile === p.name ? settings.lastRegion : null))
      } catch (e) {
        set({ ready: true, bootError: report(e) })
      }
    },

    applyUpdate: (u) => {
      const s = get()
      const merged = mergeUpdate(s, u, s.focus)
      if (!merged) return
      const patch: Partial<AppState> = { ...merged }
      const d = merged.serviceDetail
      if (d) patch.events = { ...s.events, [eventKey(d.service.clusterName, d.service.name)]: d.events }
      if (s.authExpired[u.profile]) patch.authExpired = { ...s.authExpired, [u.profile]: false }
      if (s.scopeError) patch.scopeError = null
      set(patch)
    },

    setPollStatus: (pollStatus) => {
      const profile = get().profile
      // PollStatus has no error kind, so the text tells an expired session apart from other errors.
      if (profile && pollStatus.lastError && isAuthText(pollStatus.lastError) && !get().authExpired[profile]) {
        set((s) => ({ pollStatus, authExpired: { ...s.authExpired, [profile]: true } }))
        return
      }
      set({ pollStatus })
    },

    loadScope: async () => {
      const { profile, region } = get()
      if (!profile || !region) return
      const same = () => get().profile === profile && get().region === region
      set({ loadingScope: true })
      try {
        const clusters = await api.listClusters(profile, region)
        const lists = await Promise.all(clusters.map((c) => api.listServices(profile, region, c.name)))
        if (!same()) return
        const services = lists.flat().sort((a, b) => a.clusterName.localeCompare(b.clusterName) || a.name.localeCompare(b.name))
        set((s) => ({ clusters, services, scopeError: null, authExpired: { ...s.authExpired, [profile]: false } }))
      } catch (e) {
        if (same()) set({ scopeError: report(e) })
      } finally {
        if (same()) set({ loadingScope: false })
      }
    },

    loadAllEvents: async (force = false) => {
      const { profile, region, services, eventsLoadedAt } = get()
      if (!profile || !region || !services.length) return
      if (!force && eventsLoadedAt && Date.now() - eventsLoadedAt < 30_000) return
      set({ eventsLoadedAt: Date.now() })
      const found: Record<string, ServiceEvent[]> = {}
      let failed: unknown = null
      await pool(services, 4, async (svc) => {
        try {
          const d = await api.getService(profile, region, svc.clusterName, svc.name)
          found[eventKey(svc.clusterName, svc.name)] = d.events
        } catch (e) {
          failed = e
        }
      })
      if (get().profile !== profile || get().region !== region) return
      set((s) => ({ events: { ...s.events, ...found } }))
      if (failed) report(failed)
    },

    saveSettings: async (patch) => {
      const prev = get().settings
      if (!prev) return
      const next = { ...prev, ...patch }
      set({ settings: next })
      try {
        set({ settings: await api.updateSettings(next) })
      } catch (e) {
        set({ settings: prev })
        report(e)
      }
    },

    setReadOnly: async (profile, value) => {
      try {
        const p = await api.setReadOnly(profile, value)
        set((s) => ({
          profiles: s.profiles.map((x) => (x.name === profile ? p : x)),
          settings: s.settings ? { ...s.settings, readOnly: { ...s.settings.readOnly, [profile]: value } } : s.settings,
        }))
        if (value) toast.info(`${profile} is read-only`, { description: 'Deploy, scale, stop, and exec are off.' })
        else toast.warning(`Actions allowed on ${profile}`, { description: 'Production actions still ask you to confirm.' })
      } catch (e) {
        report(e)
      }
    },

    login: async (name) => {
      const profile = name ?? get().profile
      if (!profile) return
      const id = toast.loading(`Opening the SSO login for ${profile}`, { description: 'Finish the login in your browser.' })
      try {
        await api.ssoLogin(profile)
        set((s) => ({ authExpired: { ...s.authExpired, [profile]: false } }))
        toast.success('SSO session refreshed', { id, description: `${profile} can call AWS again.` })
        if (profile === get().profile) {
          await get().loadScope()
          api.refreshNow().catch(() => {})
        }
      } catch (e) {
        toast.dismiss(id)
        report(e)
      }
    },

    report,
  }
})

/** True when the current profile blocks write actions. */
export const selectReadOnly = (s: AppState) => s.profiles.find((p) => p.name === s.profile)?.readOnly ?? true

export const selectProfile = (s: AppState) => s.profiles.find((p) => p.name === s.profile) ?? null
