import type { ReactNode } from 'react'
import { PencilEdit02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { useAllowActions } from '@/hooks/useAllowActions'
import { api } from '@/lib/api'
import { formatAccount } from '@/lib/format'
import type { AuthKind, Profile, Settings } from '@/lib/types'
import { useApp } from '@/store/app'
import { EnvDot } from '@/components/shell/Titlebar'

import { DataTable, type Column } from './parts/DataTable'
import { Crumbs, CopyButton, Icon, PageHeader, Panel, Segmented, Tag } from './parts/ui'

const AUTH_LABEL: Record<AuthKind, string> = {
  sso: 'SSO',
  static: 'Access key',
  assumeRole: 'Assume role',
  process: 'Credential process',
  unknown: 'Unknown',
}

const COMMON_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'ca-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'eu-north-1',
  'ap-south-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'sa-east-1',
]

const policy = (actions: string[]) =>
  JSON.stringify({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Action: actions, Resource: '*' }] }, null, 2)

export const READ_ONLY_POLICY = policy([
  'ecs:Describe*',
  'ecs:List*',
  'logs:StartLiveTail',
  'logs:FilterLogEvents',
  'logs:DescribeLogGroups',
  'cloudwatch:GetMetricData',
  'sts:GetCallerIdentity',
])

export const FULL_POLICY = policy([
  'ecs:Describe*',
  'ecs:List*',
  'ecs:UpdateService',
  'ecs:StopTask',
  'ecs:ExecuteCommand',
  'ssm:StartSession',
  'logs:StartLiveTail',
  'logs:FilterLogEvents',
  'logs:DescribeLogGroups',
  'cloudwatch:GetMetricData',
  'sts:GetCallerIdentity',
])

function Setting({ title, hint, children }: { title: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t py-3 first:border-t-0 first:pt-0">
      <div className="min-w-[220px] flex-1">
        <b className="block font-semibold">{title}</b>
        <span className="text-[12.5px] text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  )
}

function RegionEditor({ p }: { p: Profile }) {
  const settings = useApp((s) => s.settings)
  const save = useApp((s) => s.saveSettings)
  const current = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const setRegion = useApp((s) => s.setRegion)
  const options = [...new Set([...p.regions, ...COMMON_REGIONS])]

  const toggle = async (r: string, on: boolean) => {
    const next = on ? [...p.regions, r] : p.regions.filter((x) => x !== r)
    if (!next.length || !settings) return
    await save({ profileRegions: { ...settings.profileRegions, [p.name]: next } })
    const profiles = await api.listProfiles().catch(() => null)
    if (profiles) useApp.setState({ profiles })
    if (p.name === current && region && !next.includes(region)) void setRegion(next[0])
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {p.regions.map((r) => (
        <Tag key={r}>{r}</Tag>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={`Edit regions for ${p.name}`}>
            <Icon icon={PencilEdit02Icon} size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-auto">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Regions for {p.name}</DropdownMenuLabel>
          {options.map((r) => (
            <DropdownMenuCheckboxItem
              key={r}
              checked={p.regions.includes(r)}
              disabled={p.regions.length === 1 && p.regions[0] === r}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(v) => void toggle(r, !!v)}
            >
              <span className="font-mono text-xs">{r}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

