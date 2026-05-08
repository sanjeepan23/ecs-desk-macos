import type { IconSvgElement } from '@hugeicons/react'
import {
  Activity01Icon,
  ComputerTerminal01Icon,
  CubeIcon,
  DashboardSquare02Icon,
  GlobalIcon,
  Home01Icon,
  Layers01Icon,
  Settings02Icon,
  TextAlignLeftIcon,
} from '@hugeicons/core-free-icons'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTerminal } from '@/features/terminal'
import { cn } from '@/lib/utils'
import { useApp, type View } from '@/store/app'
import { Icon } from '@/views/parts/ui'

type NavName = 'fleet' | 'overview' | 'clusters' | 'services' | 'tasks' | 'logs' | 'events' | 'settings'

const NAV: [NavName, IconSvgElement, string][] = [
  ['fleet', GlobalIcon, 'All accounts'],
  ['overview', Home01Icon, 'Overview'],
  ['clusters', DashboardSquare02Icon, 'Clusters'],
  ['services', Layers01Icon, 'Services'],
  ['tasks', CubeIcon, 'Tasks'],
  ['logs', TextAlignLeftIcon, 'Logs'],
  ['events', Activity01Icon, 'Events'],
]

/** Rail item that is active for a view. Detail views map to their list. */
export function activeNav(view: View): NavName {
  if (view.name === 'service') return 'services'
  if (view.name === 'task') return 'tasks'
  if (view.name === 'cluster') return 'clusters'
  return view.name
}

function RailButton({ label, icon, active, onClick }: { label: string; icon: IconSvgElement; active: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onClick}
          className={cn(
            'grid size-[38px] place-items-center rounded-xl text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-muted text-foreground ring-1 ring-border',
          )}
        >
          <Icon icon={icon} size={18} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function Rail() {
  const view = useApp((s) => s.view)
  const navigate = useApp((s) => s.navigate)
  const termOpen = useTerminal((s) => s.open)
  const toggleTerm = useTerminal((s) => s.toggle)
  const active = activeNav(view)
  return (
    <nav aria-label="Main" className="flex flex-col items-center gap-1 border-r bg-sidebar py-2.5">
      {NAV.map(([name, icon, label]) => (
        <RailButton key={name} label={label} icon={icon} active={active === name} onClick={() => navigate({ name } as View)} />
      ))}
      <div className="flex-1" />
      <RailButton label="Terminal (Ctrl+`)" icon={ComputerTerminal01Icon} active={termOpen} onClick={toggleTerm} />
      <RailButton label="Settings" icon={Settings02Icon} active={active === 'settings'} onClick={() => navigate({ name: 'settings' })} />
    </nav>
  )
}
