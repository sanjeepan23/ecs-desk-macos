import { useEffect, useRef, type ReactNode } from 'react'

import { TerminalPanel } from '@/features/terminal'
import { useApp } from '@/store/app'

import { AuthBanner } from './AuthBanner'
import { Rail } from './Rail'
import { ResourceTree } from './ResourceTree'
import { StatusBar } from './StatusBar'
import { Titlebar } from './Titlebar'

/** Titlebar, icon rail, resource tree, main content with the terminal below it, and status bar. */
export function AppShell({ children }: { children: ReactNode }) {
  const view = useApp((s) => s.view)
  const scrollRef = useRef<HTMLDivElement>(null)
  // A new page starts at the top. A tab change keeps the scroll position.
  const pageKey = JSON.stringify({ ...view, tab: undefined })
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [pageKey])

  return (
    <div className="grid h-full grid-rows-[44px_minmax(0,1fr)_28px]">
      <Titlebar />
      <div className="grid min-h-0 grid-cols-[56px_minmax(0,1fr)] lg:grid-cols-[56px_268px_minmax(0,1fr)]">
        <Rail />
        <ResourceTree />
        <main className="flex min-h-0 min-w-0 flex-col">
          <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto px-4 pt-[18px] pb-10 md:px-6">
            <AuthBanner />
            {children}
          </div>
          <TerminalPanel />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
