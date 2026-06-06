import { describe, expect, it } from 'vitest'

import type { FleetEntry, Profile, ServiceHealth, ServiceSummary } from '@/lib/types'

import { allHealthy, groupByProfile, mergeEntries, sortAttention, summarize, upsertEntry } from './model'

function svc(name: string, health: ServiceHealth, clusterName = 'core'): ServiceSummary {
  return {
    arn: `arn/${clusterName}/${name}`,
    name,
    clusterName,
    status: 'ACTIVE',
    desired: 2,
    running: 1,
    pending: 0,
    taskDefinition: '',
    taskDefinitionShort: '',
    launchType: null,
    health,
    deployments: [],
    createdAt: null,
    enableExecuteCommand: false,
    loadBalancers: [],
  }
}

function entry(profile: string, region: string, p: Partial<FleetEntry> = {}): FleetEntry {
  return {
    profile,
    region,
    status: 'ok',
    message: null,
    isProd: false,
    clusters: 1,
    services: 2,
    runningTasks: 2,
    desiredTasks: 2,
    attention: [],
    scannedAt: 1,
    ...p,
  }
}

function profile(name: string, regions: string[], p: Partial<Profile> = {}): Profile {
  return { name, accountId: '123412341234', region: regions[0], regions, authKind: 'sso', isProd: false, readOnly: false, ...p }
}

