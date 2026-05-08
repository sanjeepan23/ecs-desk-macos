import { useEffect } from 'react'

import { api, events } from '@/lib/api'
import { useApp } from '@/store/app'

/** Subscribes the store to poller events. Mount once at the root. */
export function useEcsEvents() {
  useEffect(() => {
    let alive = true
    const offs: (() => void)[] = []
    const keep = (p: Promise<() => void>) =>
      p.then((off) => (alive ? offs.push(off) : off())).catch(() => {})
    keep(events.onEcsUpdate((u) => useApp.getState().applyUpdate(u)))
    keep(events.onPollStatus((s) => useApp.getState().setPollStatus(s)))
    keep(
      events.onProfilesChanged(() => {
        Promise.all([api.getSettings(), api.listProfiles()])
          .then(([settings, profiles]) => alive && useApp.setState({ settings, profiles }))
          .catch(() => {})
      }),
    )
    api
      .pollStatus()
      .then((s) => alive && useApp.getState().setPollStatus(s))
      .catch(() => {})
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [])
}
