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

function ProfilePicker() {
  const [open, setOpen] = useState(false)
  const profiles = useApp((s) => s.profiles)
  const current = useApp(selectProfile)
  const readOnly = useApp(selectReadOnly)
  const setProfile = useApp((s) => s.setProfile)
  const setReadOnly = useApp((s) => s.setReadOnly)
  const login = useApp((s) => s.login)
  const navigate = useApp((s) => s.navigate)
  const requestAllow = useAllowActions((s) => s.request)

  const row = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent outline-none'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-xl" aria-label="AWS profile">
          {current ? (
            <>
              <EnvDot prod={current.isProd} />
              <span className="max-w-40 truncate">{current.name}</span>
              {readOnly && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2 text-xs font-medium text-warn">
                  <Icon icon={LockIcon} size={12} />
                  Read-only
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">No profile</span>
          )}
          <Icon icon={ArrowDown01Icon} className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 p-1.5">
        <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">AWS profiles</div>
        {profiles.map((p) => (
          <button
            key={p.name}
            type="button"
            className={row}
            onClick={() => {
              setOpen(false)
              void setProfile(p.name)
            }}
          >
            <EnvDot prod={p.isProd} />
            <span className="flex-1 truncate">{p.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{formatAccount(p.accountId)}</span>
            <Icon icon={Tick02Icon} className={cn(p.name !== current?.name && 'invisible')} />
          </button>
        ))}
        {!profiles.length && <div className="px-3 py-2 text-sm text-muted-foreground">No profiles in ~/.aws/config.</div>}
        {current && (
          <>
            <Separator className="my-1.5" />
            <label className={cn(row, 'cursor-pointer')}>
              <Icon icon={LockIcon} />
              <span className="flex-1">Read-only for {current.name}</span>
              <Switch
                checked={readOnly}
                onCheckedChange={(v) => {
                  if (v) void setReadOnly(current.name, true)
                  else {
                    setOpen(false)
                    requestAllow(current.name)
                  }
                }}
                aria-label={`Read-only for ${current.name}`}
              />
            </label>
            <button
              type="button"
              className={row}
              onClick={() => {
                setOpen(false)
                void login(current.name)
              }}
            >
              <Icon icon={UserIcon} />
              Refresh SSO login
            </button>
          </>
        )}
        <button
          type="button"
          className={row}
          onClick={() => {
            setOpen(false)
            navigate({ name: 'settings' })
          }}
        >
          <Icon icon={Settings02Icon} />
          Manage profiles
        </button>
      </PopoverContent>
    </Popover>
  )
}

