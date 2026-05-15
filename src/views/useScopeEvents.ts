import { useEffect, useMemo } from 'react'

import { useApp } from '@/store/app'
import { flattenEvents } from '@/store/merge'

/** Loads events of all services in the current region, and returns them newest first. */
export function useScopeEvents() {
  const profile = useApp((s) => s.profile)
  const region = useApp((s) => s.region)
  const hasServices = useApp((s) => s.services.length > 0)
  const loadAllEvents = useApp((s) => s.loadAllEvents)
  const events = useApp((s) => s.events)
  useEffect(() => {
    if (hasServices) void loadAllEvents()
  }, [profile, region, hasServices, loadAllEvents])
  return useMemo(() => flattenEvents(events), [events])
}
