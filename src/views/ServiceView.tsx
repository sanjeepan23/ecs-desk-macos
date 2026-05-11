import { useMemo, useState } from 'react'
import { ArrowExpandIcon, Rocket01Icon, Undo02Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useServiceActions } from '@/features/actions'
import { DeployTimeline } from '@/features/deploywatch'
import { LogsPanel } from '@/features/logs'
import { MetricsPanel, MetricsSummary } from '@/features/metrics'
import { StoppedGroups, StoppedSummary } from '@/features/stopped'
import { useAsync } from '@/hooks/useAsync'
import { api } from '@/lib/api'
import { ago, dateTime, pct, taskDefFamily, taskDefShort } from '@/lib/format'
import { deploymentStatusLabel, healthMeta, primaryDeployment, rolloutMeta } from '@/lib/status'
import type { ServiceSummary, Task } from '@/lib/types'
import { useApp, type ServiceTab } from '@/store/app'

import { DataTable, type Column } from './parts/DataTable'
import { JsonView } from './parts/JsonView'
import { EventsTable, ServiceMenu, TaskTable } from './parts/tables'
import {
  ActionButton,
  CopyButton,
  EmptyState,
  ErrorState,
  HealthBadge,
  KV,
  PageHeader,
  Panel,
  ReadOnlyBanner,
  ScopeCrumbs,
  SectionTitle,
  Segmented,
  Tag,
  ToneBadge,
  Toolbar,
  UsageBar,
} from './parts/ui'

const TABS: [ServiceTab, string][] = [
  ['overview', 'Overview'],
  ['tasks', 'Tasks'],
  ['deployments', 'Deployments'],
  ['events', 'Events'],
  ['logs', 'Logs'],
  ['metrics', 'Metrics'],
  ['config', 'Task definition'],
]

