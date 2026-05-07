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

let eventSeq = 0

/** Adds an event to the top of the service event list. */
export function addEvent(svc: MockService, message: string, at = Date.now()) {
  svc.events.unshift({ id: `evt-${++eventSeq}`, createdAt: at, message })
  svc.events.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  svc.events = svc.events.slice(0, 100)
}

function deployment(
  r: () => number,
  td: string,
  status: string,
  d: { desired: number; running: number; pending: number; rollout: string; createdAt: number },
): Deployment {
  return {
    id: `ecs-svc/${Array.from({ length: 19 }, () => Math.floor(r() * 10)).join('')}`,
    status,
    taskDefinition: td,
    desired: d.desired,
    running: d.running,
    pending: d.pending,
    failed: 0,
    rolloutState: d.rollout,
    rolloutReason: d.rollout === 'COMPLETED' ? 'ECS deployment completed.' : null,
    createdAt: d.createdAt,
    updatedAt: d.createdAt + 90e3,
  }
}

function makeService(name: string, cluster: string, p: ProfileSeed, region: string): MockService {
  const b = SVC[name]
  const r = rng(p.name + region + cluster + name)
  const account = p.accountId
  const td = (rev: number) => taskDefArn(region, account, name, rev)
  const summary: ServiceSummary = {
    arn: `arn:aws:ecs:${region}:${account}:service/${cluster}/${name}`,
    name,
    clusterName: cluster,
    status: 'ACTIVE',
    desired: b.desired,
    running: b.desired,
    pending: 0,
    taskDefinition: td(b.rev),
    taskDefinitionShort: `${name}:${b.rev}`,
    launchType: 'FARGATE',
    health: 'healthy',
    deployments: [],
    createdAt: T0 - 400 * 86400e3,
    enableExecuteCommand: !(p.isProd && name === 'web-frontend'),
    loadBalancers: b.port ? [`arn:aws:elasticloadbalancing:${region}:${account}:targetgroup/${name}-tg/${hex(r, 16)}`] : [],
  }
  const svc: MockService = {
    profile: p.name,
    region,
    env: p.env,
    summary,
    events: [],
    tasks: [],
    stopped: [],
    port: b.port,
    cpuUnits: b.cpu,
    memMiB: b.mem,
    cpuBase: b.cpuBase,
    memBase: b.memBase,
  }
  const now = T0
  const special = p.name === 'demo-prod' && region === 'us-east-1' && cluster === 'core-prod'
  const ev = (at: number, m: string) => svc.events.push({ id: `evt-${++eventSeq}`, createdAt: at, message: m })

  if (special && name === 'payments-worker') {
    summary.health = 'deploying'
    summary.taskDefinition = td(58)
    summary.taskDefinitionShort = `${name}:58`
    summary.pending = 1
    summary.deployments = [
      deployment(r, td(58), 'PRIMARY', { desired: 4, running: 1, pending: 1, rollout: 'IN_PROGRESS', createdAt: now - 4 * 60e3 }),
      deployment(r, td(57), 'ACTIVE', { desired: 3, running: 3, pending: 0, rollout: 'COMPLETED', createdAt: now - 6 * 86400e3 }),
    ]
    for (let i = 0; i < 3; i++) svc.tasks.push(makeTask(svc, r, { rev: 57 }))
    svc.tasks.push(makeTask(svc, r, { rev: 58, startedAt: now - 3 * 60e3 }))
    svc.tasks.push(makeTask(svc, r, { rev: 58, status: 'PROVISIONING', health: 'UNKNOWN', startedAt: now - 40e3 }))
    summary.running = 4
    ev(now - 40e3, `(service payments-worker) has started 1 tasks: (task ${svc.tasks[4].id.slice(0, 8)}).`)
    ev(now - 3 * 60e3, `(service payments-worker) has started 1 tasks: (task ${svc.tasks[3].id.slice(0, 8)}).`)
    ev(now - 4 * 60e3, '(service payments-worker) updated the task definition to payments-worker:58.')
    ev(now - 6 * 86400e3, '(service payments-worker) has reached a steady state.')
  } else if (special && name === 'notifications') {
    summary.health = 'failing'
    summary.running = 1
    summary.pending = 1
    svc.tasks.push(makeTask(svc, r, { startedAt: now - 9 * 60e3 }))
    svc.tasks.push(makeTask(svc, r, { status: 'PROVISIONING', health: 'UNKNOWN', startedAt: now - 25e3 }))
    for (let i = 0; i < 3; i++) {
      svc.stopped.push(
        makeTask(svc, r, {
          status: 'STOPPED',
          health: 'UNHEALTHY',
          exitCode: 137,
          startedAt: now - (14 + i * 7) * 60e3,
          stopReason: 'Essential container in task exited. OutOfMemoryError: Container killed due to memory usage',
        }),
      )
    }
    summary.deployments = [
      deployment(r, td(31), 'PRIMARY', { desired: 2, running: 1, pending: 1, rollout: 'COMPLETED', createdAt: now - 2 * 86400e3 }),
    ]
    const st = (i: number) => svc.stopped[i].id.slice(0, 8)
    ev(now - 25e3, `(service notifications) has started 1 tasks: (task ${svc.tasks[1].id.slice(0, 8)}).`)
    ev(now - 31e3, `(service notifications) stopped 1 running tasks: (task ${st(0)}). Reason: OutOfMemoryError.`)
    ev(now - 7 * 60e3, `(service notifications) has started 1 tasks: (task ${svc.tasks[0].id.slice(0, 8)}).`)
    ev(now - 8 * 60e3, `(service notifications) stopped 1 running tasks: (task ${st(1)}). Reason: OutOfMemoryError.`)
    ev(now - 14 * 60e3, `(service notifications) stopped 1 running tasks: (task ${st(2)}). Reason: OutOfMemoryError.`)
    ev(now - 2 * 86400e3, '(service notifications) has reached a steady state.')
  } else {
    for (let i = 0; i < b.desired; i++) svc.tasks.push(makeTask(svc, r, {}))
    const created = now - Math.floor(r() * 9 + 1) * 86400e3
    summary.deployments = [
      deployment(r, td(b.rev), 'PRIMARY', { desired: b.desired, running: b.desired, pending: 0, rollout: 'COMPLETED', createdAt: created }),
    ]
    // One stopped task per service, so the Stopped filter is not empty.
    svc.stopped.push(makeTask(svc, r, { status: 'STOPPED', startedAt: created - 86400e3, stopReason: 'Scaling activity initiated by deployment.' }))
    ev(now - Math.floor(r() * 5 + 1) * 3600e3, `(service ${name}) has reached a steady state.`)
    ev(now - Math.floor(r() * 4 + 7) * 3600e3, `(service ${name}) has reached a steady state.`)
    ev(created + 90e3, `(service ${name}) has started ${b.desired} tasks.`)
    ev(created, `(service ${name}) updated the task definition to ${name}:${b.rev}.`)
  }
  svc.events.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return svc
}

/** Clusters of one profile and region. The world builds on first use. */
export function world(profile: string, region: string): MockCluster[] {
  const key = `${profile}/${region}`
  let w = WORLD.get(key)
  if (w) return w
  const p = seedOf(profile)
  const ri = Math.max(0, p.regions.indexOf(region))
  const layout = ri === 0 ? LAYOUT.primary : LAYOUT.secondary
  w = layout.map(([base, names]) => {
    const name = `${base}-${p.env}${ri === 0 ? '' : '-' + region.split('-')[0]}`
    return {
      name,
      arn: `arn:aws:ecs:${region}:${p.accountId}:cluster/${name}`,
      capacityProviders: base === 'core' ? ['FARGATE', 'FARGATE_SPOT'] : ['FARGATE'],
      containerInsights: base === 'core',
      services: names.map((n) => makeService(n, name, p, region)),
    }
  })
  WORLD.set(key, w)
  return w
}

export function findService(profile: string, region: string, cluster: string, service: string): MockService | undefined {
  return world(profile, region)
    .find((c) => c.name === cluster)
    ?.services.find((s) => s.summary.name === service)
}

/** Finds a task by ARN or ID, in active and stopped lists. */
export function findTask(profile: string, region: string, cluster: string, taskArn: string): { svc: MockService; task: Task } | undefined {
  const c = world(profile, region).find((x) => x.name === cluster)
  for (const svc of c?.services ?? []) {
    const task = [...svc.tasks, ...svc.stopped].find((t) => t.arn === taskArn || t.id === taskArn)
    if (task) return { svc, task }
  }
  return undefined
}

/** Updates running and pending counts from the task lists. Call it after you change tasks. */
export function recompute(svc: MockService) {
  const s = svc.summary
  s.running = svc.tasks.filter((t) => t.lastStatus === 'RUNNING').length
  s.pending = svc.tasks.filter((t) => t.lastStatus !== 'RUNNING').length
}

function clusterSummary(c: MockCluster): ClusterSummary {
  return {
    arn: c.arn,
    name: c.name,
    status: 'ACTIVE',
    activeServices: c.services.length,
    runningTasks: c.services.reduce((a, s) => a + s.summary.running, 0),
    pendingTasks: c.services.reduce((a, s) => a + s.summary.pending, 0),
    capacityProviders: c.capacityProviders,
    containerInsights: c.containerInsights,
  }
}

const clone = <T>(v: T): T => structuredClone(v)

/* ---------- Task definition ---------- */

export function taskDefinitionJson(profile: string, region: string, taskDefinition: string): Record<string, unknown> | null {
  const short = taskDefinition.split('/').pop() ?? taskDefinition
  const [family, revStr] = short.split(':')
  const svc = world(profile, region)
    .flatMap((c) => c.services)
    .find((s) => s.summary.name === family)
  if (!svc) return null
  const rev = Number(revStr) || Number(svc.summary.taskDefinitionShort.split(':')[1])
  const account = accountOf(profile)
  return {
    taskDefinitionArn: taskDefArn(region, account, family, rev),
    family,
    revision: rev,
    status: 'ACTIVE',
    networkMode: 'awsvpc',
    requiresCompatibilities: ['FARGATE'],
    cpu: String(svc.cpuUnits),
    memory: String(svc.memMiB),
    executionRoleArn: `arn:aws:iam::${account}:role/${family}-exec`,
    taskRoleArn: `arn:aws:iam::${account}:role/${family}-task`,
    containerDefinitions: [
      {
        name: family,
        image: `${account}.dkr.ecr.${region}.amazonaws.com/${family}:v${rev}.0.2`,
        essential: true,
        cpu: svc.cpuUnits - 128,
        memory: svc.memMiB - 256,
        portMappings: svc.port ? [{ containerPort: svc.port, protocol: 'tcp' }] : [],
        environment: [
          { name: 'APP_ENV', value: svc.env },
          { name: 'LOG_LEVEL', value: 'info' },
        ],
        secrets: [{ name: 'DATABASE_URL', valueFrom: `arn:aws:ssm:${region}:${account}:parameter/${svc.env}/${family}/db` }],
        logConfiguration: {
          logDriver: 'awslogs',
          options: { 'awslogs-group': `/ecs/${family}`, 'awslogs-region': region, 'awslogs-stream-prefix': 'ecs' },
        },
        ...(svc.port
          ? { healthCheck: { command: ['CMD-SHELL', `curl -f http://localhost:${svc.port}/health || exit 1`], interval: 30, retries: 3 } }
          : {}),
      },
      {
        name: 'otel-collector',
        image: 'public.ecr.aws/aws-observability/aws-otel-collector:v0.40.0',
        essential: false,
        cpu: 128,
        memory: 256,
        logConfiguration: {
          logDriver: 'awslogs',
          options: { 'awslogs-group': `/ecs/${family}`, 'awslogs-region': region, 'awslogs-stream-prefix': 'otel' },
        },
      },
    ],
    registeredAt: new Date(T0 - 86400e3).toISOString(),
  }
}

/* ---------- Settings and profiles ---------- */

const SETTINGS_KEY = 'ecsdesk-mock-settings'

function defaultSettings(): Settings {
  return {
    pollFocusedSecs: 3,
    pollBackgroundSecs: 45,
    confirmProdByTyping: true,
    telemetry: false,
    theme: 'system',
    profileRegions: {},
    readOnly: {},
    lastProfile: null,
    lastRegion: null,
    detectedProd: [],
  }
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) }
  } catch {
    // Storage can be blocked. The defaults then apply.
  }
  return defaultSettings()
}

let settings: Settings = loadSettings()

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be blocked. Settings then last for this page load only.
  }
}

export function mockSettings(): Settings {
  return settings
}

export function isReadOnly(profile: string): boolean {
  return settings.readOnly[profile] ?? seedOf(profile).isProd
}

function toProfile(p: ProfileSeed): Profile {
  const regions = settings.profileRegions[p.name]?.length ? settings.profileRegions[p.name] : p.regions
  return {
    name: p.name,
    accountId: p.accountId,
    region: p.regions[0],
    regions,
    authKind: p.authKind,
    isProd: p.isProd,
    readOnly: isReadOnly(p.name),
  }
}

/* ---------- Session and throttle simulation ---------- */

const expired = new Set<string>()
let throttled = false

export function mockError(kind: AppError['kind'], message: string): AppError {
  return { kind, message }
}

/** Throws an auth error when the SSO session of the profile is expired. */
export function checkSession(profile: string) {
  if (expired.has(profile)) throw mockError('auth', `The SSO session for ${profile} has expired. Run "Log in" to start a new one.`)
}

/** Dev helpers. In the browser console: `__ecsMock.expireSession('demo-prod')` or `__ecsMock.setThrottled(true)`. */
export const mockControls = {
  expireSession(profile: string) {
    expired.add(profile)
  },
  setThrottled(v: boolean) {
    throttled = v
  },
}

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__ecsMock = mockControls

/* ---------- Poller ---------- */

let focus: Focus | null = null
let timer: ReturnType<typeof setInterval> | null = null
let apiCalls = 38
let lastPolledAt: number | null = null
let lastError: string | null = null

