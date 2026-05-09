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

export function UsageBar({ value, tone, className }: { value: number; tone: Tone | 'fg'; className?: string }) {
  return (
    <div className={cn('h-1.5 min-w-16 overflow-hidden rounded-full bg-muted', className)}>
      <span
        className={cn('block h-full rounded-full transition-[width] duration-500', tone === 'fg' ? 'bg-foreground' : TONE_BG[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export interface Crumb {
  label: string
  onClick?: () => void
}

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <Icon icon={ArrowRight01Icon} size={12} />}
          {c.onClick ? (
            <button type="button" className="rounded-sm hover:text-foreground hover:underline" onClick={c.onClick}>
              {c.label}
            </button>
          ) : (
            <span>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/** Breadcrumb that starts with the profile and region. */
export function ScopeCrumbs({ items }: { items: Crumb[] }) {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  return <Crumbs items={[{ label: profile ?? '—' }, { label: region ?? '—' }, ...items]} />
}

export function PageHeader({
  title,
  sub,
  actions,
  mono,
}: {
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  mono?: boolean
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start gap-4">
      <div className="min-w-0">
        <h1 className={cn('text-[22px] font-semibold tracking-tight text-balance break-all', mono && 'font-mono text-[19px]')}>{title}</h1>
        {sub && <div className="mt-1 flex flex-wrap items-center gap-2.5 text-muted-foreground">{sub}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-[22px] mb-2.5 flex items-center gap-2 text-[13px] font-semibold">
      {children}
      {right}
    </div>
  )
}

export function StatCard({ label, value, hint, valueClass }: { label: string; value: ReactNode; hint?: ReactNode; valueClass?: string }) {
  return (
    <Card size="sm" className="gap-0 py-4">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn('num mt-0.5 text-[26px] font-semibold tracking-tight', valueClass)}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

export function Panel({
  title,
  right,
  children,
  flush,
  className,
}: {
  title: ReactNode
  right?: ReactNode
  children: ReactNode
  /** Content touches the card edges, for lists. */
  flush?: boolean
  className?: string
}) {
  return (
    <Card size="sm" className={cn('min-w-0 gap-3', flush && 'pb-0', className)}>
      <CardHeader className="flex items-center gap-2">
        <CardTitle className="flex flex-1 items-center gap-2 text-[13px] font-semibold">{title}</CardTitle>
        {right && <div className="ml-auto flex items-center gap-2 text-sm font-normal">{right}</div>}
      </CardHeader>
      <CardContent className={cn(flush && 'px-0')}>{children}</CardContent>
    </Card>
  )
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-2 text-[13px] sm:grid-cols-[140px_minmax(0,1fr)]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="mb-1.5 min-w-0 [overflow-wrap:anywhere] sm:mb-0">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      spacing={0}
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-3 text-[12.5px] data-[state=on]:bg-background data-[state=on]:shadow-sm dark:data-[state=on]:bg-muted">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-2">{children}</div>
}

export function EmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border bg-card p-8 text-center text-muted-foreground', className)}>{children}</div>
}

/** Inline error with a "Log in" button for auth errors and a "Try again" button for others. */
export function ErrorState({ error, onRetry }: { error: AppError; onRetry?: () => void }) {
  const profile = useApp((s) => s.profile)
  const login = useApp((s) => s.login)
  const auth = error.kind === 'auth'
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-8 text-center">
      <Icon icon={Alert02Icon} className="text-crit" size={20} />
      <div>
        <div className="font-semibold">{auth ? `Your session for ${profile} has expired.` : 'The data did not load.'}</div>
        <div className="mt-1 max-w-md text-[12.5px] text-muted-foreground">{auth ? 'Log in again to continue.' : error.message}</div>
      </div>
      {auth ? (
        <Button size="sm" onClick={() => void login()}>
          <Icon icon={Login01Icon} />
          Log in
        </Button>
      ) : (
        onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <Icon icon={RefreshIcon} />
            Try again
          </Button>
        )
      )}
    </div>
  )
}

export function Banner({
  tone,
  icon,
  children,
  action,
}: {
  tone: 'warn' | 'crit' | 'info'
  icon: IconSvgElement
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-2.5',
        tone === 'warn' ? 'bg-warn-bg' : tone === 'crit' ? 'bg-crit-bg' : 'bg-info-bg',
      )}
    >
      <Icon icon={icon} className={TONE_TEXT[tone]} />
      <div className="min-w-[200px] flex-1">{children}</div>
      {action}
    </div>
  )
}

