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

const VIEWS: { label: string; view: View; icon: typeof Home01Icon }[] = [
  { label: 'Overview', view: { name: 'overview' }, icon: Home01Icon },
  { label: 'Clusters', view: { name: 'clusters' }, icon: DashboardSquare01Icon },
  { label: 'Services', view: { name: 'services' }, icon: Layers01Icon },
  { label: 'Tasks', view: { name: 'tasks' }, icon: CubeIcon },
  { label: 'Logs', view: { name: 'logs' }, icon: TextAlignLeftIcon },
  { label: 'Events', view: { name: 'events' }, icon: Activity01Icon },
  { label: 'All accounts', view: { name: 'fleet' }, icon: Activity01Icon },
  { label: 'Settings', view: { name: 'settings' }, icon: Settings01Icon },
]

const ITEM_ICON: Record<string, typeof Home01Icon> = {
  ...Object.fromEntries(VIEWS.map((v) => [`go:${v.view.name}`, v.icon])),
  'act:theme': Moon02Icon,
  'act:refresh': RefreshIcon,
  'act:terminal': ComputerTerminal01Icon,
}

function toggleTheme() {
  const dark = document.documentElement.classList.contains('dark')
  useApp
    .getState()
    .saveSettings({ theme: dark ? 'light' : 'dark' })
    .catch(() => {})
}

async function refreshNow() {
  try {
    await api.refreshNow()
    toast.success('Refreshed')
  } catch (e) {
    toast.error('Could not refresh', { description: asAppError(e).message })
  }
}

/** Builds the palette items from the current app state. */
function useItems(open: boolean): PaletteItem[] {
  const services = useApp((s) => s.services)
  const clusters = useApp((s) => s.clusters)
  const tasks = useApp((s) => s.tasks)
  const profiles = useApp((s) => s.profiles)
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)

  return useMemo(() => {
    if (!open) return []
    const { navigate, setProfile } = useApp.getState()
    const items: PaletteItem[] = VIEWS.map((v) => ({
      id: `go:${v.view.name}`,
      group: 'Go to',
      label: v.label,
      run: () => navigate(v.view),
    }))
    for (const s of services)
      items.push({
        id: `svc:${s.clusterName}/${s.name}`,
        group: 'Services',
        label: s.name,
        hint: s.clusterName,
        health: s.health,
        keywords: [s.taskDefinitionShort, s.health],
        run: () => navigate({ name: 'service', cluster: s.clusterName, service: s.name }),
      })
    for (const c of clusters)
      items.push({
        id: `cl:${c.name}`,
        group: 'Clusters',
        label: c.name,
        hint: region ?? undefined,
        run: () => navigate({ name: 'cluster', cluster: c.name }),
      })
    for (const t of tasks)
      items.push({
        id: `task:${t.arn}`,
        group: 'Tasks',
        label: shortTaskId(t.id || t.arn),
        hint: `${t.serviceName ?? t.clusterName} · ${t.lastStatus.toLowerCase()}`,
        keywords: [t.id, t.privateIp ?? '', ...t.containers.map((c) => c.name)],
        run: () => navigate({ name: 'task', cluster: t.clusterName, service: t.serviceName, taskArn: t.arn }),
      })
    for (const p of profiles)
      if (p.name !== profile)
        items.push({
          id: `prof:${p.name}`,
          group: 'Profiles',
          label: `Switch to ${p.name}`,
          hint: [p.accountId, p.isProd ? 'production' : null].filter(Boolean).join(' · '),
          keywords: ['profile', 'account'],
          run: () => void setProfile(p.name),
        })
    items.push(
      { id: 'act:theme', group: 'Actions', label: 'Toggle theme', keywords: ['dark', 'light'], run: toggleTheme },
      { id: 'act:refresh', group: 'Actions', label: 'Refresh now', keywords: ['reload', 'poll'], run: () => void refreshNow() },
      {
        id: 'act:terminal',
        group: 'Actions',
        label: 'Open terminal',
        hint: 'Ctrl+`',
        keywords: ['exec', 'shell'],
        run: () => useTerminal.getState().show(),
      },
    )
    return items
  }, [open, services, clusters, tasks, profiles, profile, region])
}

function itemIcon(it: PaletteItem) {
  return ITEM_ICON[it.id] ?? (it.group === 'Tasks' ? Task01Icon : it.group === 'Clusters' ? ServerStack01Icon : GROUP_ICON[it.group])
}

/** Mount once near the app root. Registers the keyboard shortcut. */
export function CommandPalette() {
  const { open, setOpen } = usePalette()
  const [query, setQuery] = useState('')
  const items = useItems(open)
  const groups = useMemo(() => groupItems(filterItems(items, query)), [items, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        usePalette.getState().setOpen(!usePalette.getState().open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const run = (it: PaletteItem) => {
    setOpen(false)
    // Run after the dialog closes, so a dialog that the item opens gets the focus.
    setTimeout(it.run, 0)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Search services, clusters, tasks, and actions" className="sm:max-w-xl">
      <Command shouldFilter={false} loop>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search services, clusters, tasks, actions" />
        <CommandList className="max-h-[min(420px,60vh)]">
          <CommandEmpty>No results. Try a service name, such as orders-api.</CommandEmpty>
          {groups.map(([group, list]) => (
            <CommandGroup key={group} heading={group}>
              {list.map((it) => (
                <CommandItem key={it.id} value={it.id} onSelect={() => run(it)}>
                  {it.health ? (
                    <span className={cn('size-2 shrink-0 rounded-full', HEALTH_DOT[it.health])} aria-label={it.health} />
                  ) : (
                    <HugeiconsIcon icon={itemIcon(it)} className="text-muted-foreground" />
                  )}
                  <span className={cn('truncate', it.group === 'Tasks' && 'font-mono text-xs')}>{it.label}</span>
                  {it.hint && <CommandShortcut className="font-mono tracking-normal">{it.hint}</CommandShortcut>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
