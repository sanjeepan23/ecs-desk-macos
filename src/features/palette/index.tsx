// Command palette on Cmd+K / Ctrl+K.

import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Activity01Icon,
  ComputerTerminal01Icon,
  CubeIcon,
  DashboardSquare01Icon,
  Home01Icon,
  Layers01Icon,
  Moon02Icon,
  RefreshIcon,
  ServerStack01Icon,
  Settings01Icon,
  Task01Icon,
  TextAlignLeftIcon,
  UserSwitchIcon,
} from '@hugeicons/core-free-icons'

import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from '@/components/ui/command'
import { api, asAppError } from '@/lib/api'
import type { ServiceHealth } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useApp, type View } from '@/store/app'

import { shortTaskId } from '../shared/text'
import { useTerminal } from '../terminal/store'
import { filterItems, groupItems, type PaletteGroup, type PaletteItem } from './items'

export const usePalette = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}))

const HEALTH_DOT: Record<ServiceHealth, string> = {
  healthy: 'bg-emerald-500',
  deploying: 'bg-blue-500',
  degraded: 'bg-amber-500',
  failing: 'bg-red-500',
}

const GROUP_ICON: Record<PaletteGroup, typeof Home01Icon> = {
  'Go to': Home01Icon,
  Services: Layers01Icon,
  Clusters: DashboardSquare01Icon,
  Tasks: CubeIcon,
  Profiles: UserSwitchIcon,
  Actions: Activity01Icon,
}

