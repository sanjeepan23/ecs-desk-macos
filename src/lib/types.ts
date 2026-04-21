// Mirrors src-tauri/src/models.rs. Keep the two files in step.

export type AuthKind = 'sso' | 'static' | 'assumeRole' | 'process' | 'unknown'

export interface Profile {
  name: string
  accountId: string | null
  region: string | null
  regions: string[]
  authKind: AuthKind
  isProd: boolean
  readOnly: boolean
}

export interface CallerIdentity {
  account: string
  arn: string
  userId: string
}

export interface Settings {
  pollFocusedSecs: number
  pollBackgroundSecs: number
  confirmProdByTyping: boolean
  telemetry: boolean
  theme: 'system' | 'light' | 'dark'
  profileRegions: Record<string, string[]>
  readOnly: Record<string, boolean>
  lastProfile: string | null
  lastRegion: string | null
  /** Profiles that reach a cluster or service with "prod" in its name. */
  detectedProd: string[]
}

export interface ClusterSummary {
  arn: string
  name: string
  status: string
  activeServices: number
  runningTasks: number
  pendingTasks: number
  capacityProviders: string[]
  containerInsights: boolean
}

export type ServiceHealth = 'healthy' | 'deploying' | 'degraded' | 'failing'

export interface Deployment {
  id: string
  status: 'PRIMARY' | 'ACTIVE' | 'INACTIVE' | string
  taskDefinition: string
  desired: number
  running: number
  pending: number
  failed: number
  rolloutState: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | string | null
  rolloutReason: string | null
  /** Unix ms */
  createdAt: number | null
  updatedAt: number | null
}

export interface ServiceSummary {
  arn: string
  name: string
  clusterName: string
  status: string
  desired: number
  running: number
  pending: number
  taskDefinition: string
  /** "family:revision" */
  taskDefinitionShort: string
  launchType: string | null
  health: ServiceHealth
  deployments: Deployment[]
  createdAt: number | null
  enableExecuteCommand: boolean
  loadBalancers: string[]
}

export interface ServiceEvent {
  id: string
  createdAt: number | null
  message: string
}

export interface ServiceDetail {
  service: ServiceSummary
  events: ServiceEvent[]
}

export interface Container {
  name: string
  image: string | null
  lastStatus: string | null
  healthStatus: string | null
  exitCode: number | null
  reason: string | null
  runtimeId: string | null
  execAgentStatus: string | null
}

export interface Task {
  arn: string
  id: string
  clusterName: string
  serviceName: string | null
  lastStatus: string
  desiredStatus: string
  healthStatus: string | null
  taskDefinition: string
  revision: number | null
  availabilityZone: string | null
  privateIp: string | null
  cpu: string | null
  memory: string | null
  startedAt: number | null
  stoppedAt: number | null
  stopReason: string | null
  stopCode: string | null
  launchType: string | null
  enableExecuteCommand: boolean
  containers: Container[]
}

export interface Focus {
  profile: string
  region: string
  cluster: string | null
  service: string | null
}

export interface EcsUpdate {
  profile: string
  region: string
  polledAt: number
  clusters: ClusterSummary[] | null
  services: ServiceSummary[] | null
  serviceDetail: ServiceDetail | null
  tasks: Task[] | null
}

export interface PollStatus {
  polledAt: number | null
  apiCallsPerMin: number
  budgetPct: number
  throttled: boolean
  lastError: string | null
}

export interface ServiceRef {
  profile: string
  region: string
  cluster: string
  service: string
}

export interface TaskRef {
  profile: string
  region: string
  cluster: string
  taskArn: string
}

export interface LogTarget {
  group: string
  streamPrefix: string | null
  container: string | null
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface LogLine {
  timestamp: number
  level: LogLevel | string
  message: string
  group: string
  stream: string
}

export interface LogBatch {
  sessionId: string
  lines: LogLine[]
}

export interface MetricPoint {
  t: number
  v: number
}

