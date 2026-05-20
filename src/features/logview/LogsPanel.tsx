// Live log tail and search. The public entry is @/features/logs.

import '@fontsource-variable/jetbrains-mono'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Loading03Icon,
  PauseIcon,
  PlayIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { api, asAppError, events } from '@/lib/api'
import type { LogTarget, ServiceSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp } from '@/store/app'

import { hms, shortTaskDef, splitHighlight } from '../shared/text'
import { newId } from '../terminal/store'
import { filterRows, LogBuffer, MAX_LINES, sourceLabel, type Level, type LevelFilter, type Row } from './buffer'

const BACKFILL_MS = 5 * 60_000
const EARLIER_MS = 15 * 60_000
const MONO = "'JetBrains Mono Variable', ui-monospace, Menlo, Consolas, monospace"

const LEVEL_CLASS: Record<Level, string> = {
  DEBUG: 'text-muted-foreground',
  INFO: 'text-blue-600 dark:text-blue-400',
  WARN: 'text-amber-600 dark:text-amber-400',
  ERROR: 'text-red-600 dark:text-red-400',
}

type TailState = 'idle' | 'connecting' | 'live' | 'error'

