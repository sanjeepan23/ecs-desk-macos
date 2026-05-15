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

