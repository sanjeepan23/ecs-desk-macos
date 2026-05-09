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

/** Pill with an optional colored dot, like the status badges in the UI mock. */
export function ToneBadge({ tone, children, dot = true, className }: { tone: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function HealthBadge({ health }: { health: ServiceHealth | string }) {
  const m = healthMeta(health)
  return <ToneBadge tone={m.tone}>{m.label}</ToneBadge>
}

export function TaskStatusBadge({ status }: { status: string }) {
  return <ToneBadge tone={taskStatusTone(status)}>{titleCase(status)}</ToneBadge>
}

export function HealthCheckBadge({ health }: { health: string | null | undefined }) {
  const m = healthCheckMeta(health)
  return (
    <ToneBadge tone={m.tone} dot={false}>
      {m.label}
    </ToneBadge>
  )
}

export function StatusDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn('inline-block size-[7px] shrink-0 rounded-full', TONE_BG[tone], className)} />
}

/** Monospace chip for IDs, revisions, and zones. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('rounded-md border bg-muted px-1.5 py-px font-mono text-[11.5px] whitespace-nowrap', className)}>{children}</span>
  )
}

