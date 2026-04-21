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

