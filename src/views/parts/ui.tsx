// Small building blocks that many views share.

import type { ComponentProps, ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { Alert02Icon, ArrowRight01Icon, Copy01Icon, LockIcon, Login01Icon, RefreshIcon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useAllowActions } from '@/hooks/useAllowActions'
import { titleCase } from '@/lib/format'
import { healthCheckMeta, healthMeta, taskStatusTone, type Tone } from '@/lib/status'
import type { AppError, ServiceHealth } from '@/lib/types'
import { cn } from '@/lib/utils'
import { selectReadOnly, useApp } from '@/store/app'

export function Icon({ icon, className, size = 16 }: { icon: IconSvgElement; className?: string; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.8} className={cn('shrink-0', className)} aria-hidden />
}

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  info: 'text-info',
  warn: 'text-warn',
  crit: 'text-crit',
  neutral: 'text-muted-foreground',
}

export const TONE_BG: Record<Tone, string> = {
  ok: 'bg-ok',
  info: 'bg-info',
  warn: 'bg-warn',
  crit: 'bg-crit',
  neutral: 'bg-border',
}

const TONE_BADGE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  info: 'bg-info-bg text-info',
  warn: 'bg-warn-bg text-warn',
  crit: 'bg-crit-bg text-crit',
  neutral: 'bg-muted text-muted-foreground',
}

