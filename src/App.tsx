// App shell and view routing.

import { useEffect } from 'react'

import { AllowActionsDialog } from '@/components/shell/AllowActionsDialog'
import { AppShell } from '@/components/shell/AppShell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ActionDialogsHost } from '@/features/actions'
import { DeployWatchHost } from '@/features/deploywatch'
import { CommandPalette } from '@/features/palette'
import { useEcsEvents } from '@/hooks/useEcsEvents'
import { useApplyTheme } from '@/hooks/useTheme'
import { useApp } from '@/store/app'
import { ViewRouter } from '@/views'
import { ErrorState } from '@/views/parts/ui'

export default function App() {
  const dark = useApplyTheme()
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  const bootError = useApp((s) => s.bootError)
  useEcsEvents()
  useEffect(() => {
    void init()
  }, [init])

  return (
    <TooltipProvider delayDuration={300}>
      <AppShell>{!ready ? null : bootError ? <ErrorState error={bootError} onRetry={() => location.reload()} /> : <ViewRouter />}</AppShell>
      <ActionDialogsHost />
      <DeployWatchHost />
      <CommandPalette />
      <AllowActionsDialog />
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" offset={{ bottom: 40, right: 16 }} richColors={false} closeButton />
    </TooltipProvider>
  )
}
