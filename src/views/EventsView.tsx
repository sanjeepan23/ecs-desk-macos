import { RefreshIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useApp } from '@/store/app'

import { EventsTable } from './parts/tables'
import { Icon, PageHeader, ScopeCrumbs } from './parts/ui'
import { useScopeEvents } from './useScopeEvents'

export function EventsView() {
  const rows = useScopeEvents()
  const loadAllEvents = useApp((s) => s.loadAllEvents)
  const loadedAt = useApp((s) => s.eventsLoadedAt)
  return (
    <>
      <ScopeCrumbs items={[{ label: 'Events' }]} />
      <PageHeader
        title="Events"
        sub="Service events from all clusters, newest first"
        actions={
          <Button variant="outline" onClick={() => void loadAllEvents(true)}>
            <Icon icon={RefreshIcon} />
            Refresh
          </Button>
        }
      />
      {!rows.length && !loadedAt ? <Skeleton className="h-60 rounded-2xl" /> : <EventsTable rows={rows} showService />}
    </>
  )
}
