import { useState, type ReactNode } from 'react'
import { ArrowRight01Icon, DashboardSquare02Icon, Globe02Icon, Login01Icon, RefreshIcon, UserIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatAccount } from '@/lib/format'
import { healthMeta } from '@/lib/status'
import { cn } from '@/lib/utils'
import { selectProfile, useApp } from '@/store/app'
import { Icon, StatusDot } from '@/views/parts/ui'

function Node({
  level,
  selected,
  onClick,
  children,
  title,
  expanded,
}: {
  level: 1 | 2 | 3 | 4
  selected?: boolean
  onClick: () => void
  children: ReactNode
  title?: string
  expanded?: boolean
}) {
  const pad = { 1: 'pl-2', 2: 'pl-[22px]', 3: 'pl-9', 4: 'pl-[52px]' }[level]
  return (
    <button
      type="button"
      title={title}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-lg py-[5px] pr-2 text-left whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        pad,
        selected && 'bg-info-bg font-semibold text-info hover:bg-info-bg',
      )}
    >
      {children}
    </button>
  )
}

