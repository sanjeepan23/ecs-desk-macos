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

