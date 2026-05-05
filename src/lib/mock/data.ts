// Mock handlers for settings, profiles, ECS reads, and polling.
// Return undefined for a command this file does not handle, and null for a void command.
//
// The features agent may import these exports read-only from './data':
// world, findService, findTask, makeTask, addEvent, recompute, emitNow, isReadOnly, mockSettings,
// accountOf, taskDefinitionJson, mockError, checkSession, mockControls.

import type {
  AppError,
  AuthKind,
  ClusterSummary,
  Container,
  Deployment,
  EcsUpdate,
  Focus,
  PollStatus,
  Profile,
  ServiceDetail,
  ServiceEvent,
  ServiceSummary,
  Settings,
  Task,
} from '../types'
import { EVENTS } from '../types'
import { delay, emit } from './bus'

/* ---------- Seeded random ---------- */

export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

export const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('')

/* ---------- Example world (same as docs/ui-mock.html) ---------- */

interface ProfileSeed {
  name: string
  accountId: string
  env: string
  isProd: boolean
  authKind: AuthKind
  regions: string[]
}

const PROFILES: ProfileSeed[] = [
  { name: 'demo-prod', accountId: '111122223333', env: 'prod', isProd: true, authKind: 'sso', regions: ['us-east-1', 'eu-west-1'] },
  { name: 'demo-staging', accountId: '444455556666', env: 'staging', isProd: false, authKind: 'sso', regions: ['us-east-1'] },
  { name: 'demo-dev', accountId: '777788889999', env: 'dev', isProd: false, authKind: 'static', regions: ['us-east-1', 'us-west-2'] },
]

interface SvcSeed {
  desired: number
  cpu: number
  mem: number
  port: number | null
  rev: number
  cpuBase: number
  memBase: number
}

const SVC: Record<string, SvcSeed> = {
  'api-gateway': { desired: 4, cpu: 512, mem: 1024, port: 8080, rev: 88, cpuBase: 34, memBase: 52 },
  'orders-api': { desired: 6, cpu: 1024, mem: 2048, port: 8080, rev: 142, cpuBase: 46, memBase: 61 },
  'payments-worker': { desired: 4, cpu: 1024, mem: 2048, port: null, rev: 57, cpuBase: 28, memBase: 44 },
  notifications: { desired: 2, cpu: 256, mem: 512, port: 9000, rev: 31, cpuBase: 22, memBase: 71 },
  'web-frontend': { desired: 3, cpu: 512, mem: 1024, port: 3000, rev: 203, cpuBase: 18, memBase: 39 },
  'ingest-worker': { desired: 5, cpu: 2048, mem: 4096, port: null, rev: 64, cpuBase: 63, memBase: 58 },
  'etl-scheduler': { desired: 1, cpu: 512, mem: 1024, port: null, rev: 19, cpuBase: 9, memBase: 33 },
  'search-indexer': { desired: 2, cpu: 1024, mem: 4096, port: 9200, rev: 45, cpuBase: 41, memBase: 67 },
}

const LAYOUT: Record<'primary' | 'secondary', [string, string[]][]> = {
  primary: [
    ['core', ['api-gateway', 'orders-api', 'payments-worker', 'notifications', 'web-frontend']],
    ['data', ['ingest-worker', 'etl-scheduler', 'search-indexer']],
  ],
  secondary: [['core', ['api-gateway', 'orders-api', 'web-frontend']]],
}

export interface MockService {
  profile: string
  region: string
  env: string
  summary: ServiceSummary
  events: ServiceEvent[]
  /** Tasks with desired status RUNNING. */
  tasks: Task[]
  stopped: Task[]
  port: number | null
  cpuUnits: number
  memMiB: number
  /** Baseline CPU and memory use in percent, for metrics mocks. */
  cpuBase: number
  memBase: number
}

export interface MockCluster {
  name: string
  arn: string
  capacityProviders: string[]
  containerInsights: boolean
  services: MockService[]
}

const WORLD = new Map<string, MockCluster[]>()
const T0 = Date.now()

export function accountOf(profile: string): string {
  return PROFILES.find((p) => p.name === profile)?.accountId ?? '000000000000'
}

function seedOf(profile: string): ProfileSeed {
  return PROFILES.find((p) => p.name === profile) ?? PROFILES[0]
}

function taskDefArn(region: string, account: string, family: string, rev: number) {
  return `arn:aws:ecs:${region}:${account}:task-definition/${family}:${rev}`
}

/** Builds one task for a service. `opts` overrides fields such as status or revision. */
export function makeTask(
  svc: MockService,
  r: () => number,
  opts: { rev?: number; status?: string; health?: string; startedAt?: number; stopReason?: string; exitCode?: number } = {},
): Task {
  const s = svc.summary
  const account = accountOf(svc.profile)
  const id = hex(r, 32)
  const az = svc.region + ['a', 'b', 'c'][Math.floor(r() * 3)]
  const rev = opts.rev ?? Number(s.taskDefinitionShort.split(':')[1])
  const status = opts.status ?? 'RUNNING'
  const stopped = status === 'STOPPED'
  const health = opts.health ?? (svc.port ? 'HEALTHY' : 'UNKNOWN')
  const startedAt = opts.startedAt ?? Date.now() - Math.floor(r() * 5 * 86400e3) - 600e3
  const imgRepo = `${account}.dkr.ecr.${svc.region}.amazonaws.com/${s.name}`
  const cStatus = stopped ? 'STOPPED' : status === 'PROVISIONING' ? 'PENDING' : 'RUNNING'
  const containers: Container[] = [
    {
      name: s.name,
      image: `${imgRepo}:v${rev}.0.${Math.floor(r() * 9)}`,
      lastStatus: cStatus,
      healthStatus: health,
      exitCode: stopped ? (opts.exitCode ?? 0) : null,
      reason: stopped && opts.exitCode === 137 ? 'OutOfMemoryError: Container killed due to memory usage' : null,
      runtimeId: cStatus === 'PENDING' ? null : `${id}-${Math.floor(r() * 9e9)}`,
      execAgentStatus: cStatus === 'RUNNING' && s.enableExecuteCommand ? 'RUNNING' : null,
    },
    {
      name: 'otel-collector',
      image: 'public.ecr.aws/aws-observability/aws-otel-collector:v0.40.0',
      lastStatus: cStatus,
      healthStatus: 'UNKNOWN',
      exitCode: stopped ? 0 : null,
      reason: null,
      runtimeId: cStatus === 'PENDING' ? null : `${id}-${Math.floor(r() * 9e9)}`,
      execAgentStatus: cStatus === 'RUNNING' && s.enableExecuteCommand ? 'RUNNING' : null,
    },
  ]
  return {
    arn: `arn:aws:ecs:${svc.region}:${account}:task/${s.clusterName}/${id}`,
    id,
    clusterName: s.clusterName,
    serviceName: s.name,
    lastStatus: status,
    desiredStatus: stopped ? 'STOPPED' : 'RUNNING',
    healthStatus: health,
    taskDefinition: taskDefArn(svc.region, account, s.name, rev),
    revision: rev,
    availabilityZone: az,
    privateIp: `10.${svc.env === 'prod' ? 20 : 40}.${Math.floor(r() * 60) + 10}.${Math.floor(r() * 240) + 10}`,
    cpu: String(svc.cpuUnits),
    memory: String(svc.memMiB),
    startedAt: status === 'PROVISIONING' ? null : startedAt,
    stoppedAt: stopped ? startedAt + 6 * 60e3 : null,
    stopReason: stopped ? (opts.stopReason ?? 'Task stopped by user.') : null,
    stopCode: stopped ? (opts.exitCode === 137 ? 'EssentialContainerExited' : 'UserInitiated') : null,
    launchType: 'FARGATE',
    enableExecuteCommand: s.enableExecuteCommand,
    containers,
  }
}

