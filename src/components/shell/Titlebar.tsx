import {
  ArrowDown01Icon,
  Globe02Icon,
  LockIcon,
  Moon02Icon,
  Search01Icon,
  Settings02Icon,
  Sun03Icon,
  Tick02Icon,
  UserIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { usePalette } from '@/features/palette'
import { useAllowActions } from '@/hooks/useAllowActions'
import { useIsDark } from '@/hooks/useTheme'
import { isTauri } from '@/lib/api'
import { formatAccount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { selectProfile, selectReadOnly, useApp } from '@/store/app'
import { Icon } from '@/views/parts/ui'
import { useState } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export function EnvDot({ prod, className }: { prod: boolean; className?: string }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', prod ? 'bg-crit' : 'bg-ok', className)} />
}

function RegionPicker() {
  const profile = useApp(selectProfile)
  const region = useApp((s) => s.region)
  const setRegion = useApp((s) => s.setRegion)
  if (!profile) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="hidden rounded-xl md:inline-flex" aria-label={`Region ${region}`}>
          <Icon icon={Globe02Icon} />
          <span className="font-mono text-xs">{region ?? 'No region'}</span>
          <Icon icon={ArrowDown01Icon} className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Regions in {profile.name}</DropdownMenuLabel>
        {profile.regions.map((r) => (
          <DropdownMenuItem key={r} onSelect={() => void setRegion(r)}>
            <span className="font-mono text-xs">{r}</span>
            {r === region && <Icon icon={Tick02Icon} className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

