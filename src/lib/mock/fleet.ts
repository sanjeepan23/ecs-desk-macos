// Browser mock handlers for this feature.
// Return undefined for a command this file does not handle, and null for a void command.

import type { FleetEntry, Profile, ServiceHealth } from '../types'
import { EVENTS } from '../types'
import { delay, emit } from './bus'
import { checkSession, handleData, mockControls, world } from './data'

/** This profile starts the first scan with an expired SSO session, so the page shows the "Log in" path. */
const EXPIRED_PROFILE = 'demo-staging'
const MAX_PARALLEL = 4
const RANK: Record<ServiceHealth, number> = { failing: 0, degraded: 1, deploying: 2, healthy: 3 }

let entries: FleetEntry[] = []
let generation = 0
let expiredOnce = false

function pending(p: Profile, region: string): FleetEntry {
  return {
    profile: p.name,
    region,
    status: 'pending',
    message: null,
    isProd: p.isProd,
    clusters: 0,
    services: 0,
    runningTasks: 0,
    desiredTasks: 0,
    attention: [],
    scannedAt: null,
  }
}

function store(gen: number, e: FleetEntry) {
  if (gen !== generation) return
  const i = entries.findIndex((x) => x.profile === e.profile && x.region === e.region)
  if (i < 0) entries.push(e)
  else entries[i] = e
  emit(EVENTS.fleetEntry, structuredClone(e))
}

function scanResult(e: FleetEntry): FleetEntry {
  try {
    checkSession(e.profile)
  } catch {
    return { ...e, status: 'auth', message: 'Session expired. Log in to scan this profile.', scannedAt: Date.now() }
  }
  const clusters = world(e.profile, e.region)
  const services = clusters.flatMap((c) => c.services.map((s) => s.summary))
  const attention = structuredClone(services.filter((s) => s.health !== 'healthy')).sort(
    (a, b) => RANK[a.health] - RANK[b.health] || a.clusterName.localeCompare(b.clusterName) || a.name.localeCompare(b.name),
  )
  return {
    ...e,
    status: 'ok',
    message: null,
    clusters: clusters.length,
    services: services.length,
    runningTasks: services.reduce((a, s) => a + s.running, 0),
    desiredTasks: services.reduce((a, s) => a + s.desired, 0),
    attention,
    scannedAt: Date.now(),
  }
}

async function runScan(gen: number, targets: FleetEntry[]) {
  let next = 0
  const worker = async () => {
    while (next < targets.length && gen === generation) {
      const e = targets[next++]
      await delay(150 + Math.random() * 250)
      store(gen, { ...e, status: 'scanning' })
      await delay(400 + Math.random() * 600)
      store(gen, scanResult(e))
    }
  }
  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker))
}

export async function handleFleet(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  switch (cmd) {
    case 'fleet_scan': {
      if (!expiredOnce) {
        expiredOnce = true
        mockControls.expireSession(EXPIRED_PROFILE)
      }
      const only = (args.profiles as string[] | null) ?? null
      const profiles = (await handleData('list_profiles', {})) as Profile[]
      const targets = profiles.filter((p) => !only || only.includes(p.name)).flatMap((p) => p.regions.map((r) => pending(p, r)))
      generation++
      // The old scan stops, so its unfinished pairs join this scan.
      for (const e of entries) {
        const unfinished = e.status === 'pending' || e.status === 'scanning'
        if (unfinished && !targets.some((t) => t.profile === e.profile && t.region === e.region)) targets.push({ ...e, status: 'pending' })
      }
      if (!only) entries = []
      for (const t of targets) {
        const i = entries.findIndex((x) => x.profile === t.profile && x.region === t.region)
        if (i < 0) entries.push(t)
        else entries[i] = t
      }
      void runScan(generation, targets)
      return structuredClone(targets)
    }
    case 'fleet_snapshot':
      await delay(30)
      return structuredClone(entries)
    default:
      return undefined
  }
}
