import { create } from 'zustand'

import type { DeployWatch } from '@/lib/types'

import { mergeWatch } from './model'

interface WatchStore {
  /** Running watches first, then newest first. */
  watches: DeployWatch[]
  upsert: (w: DeployWatch) => void
  /** Removes a finished watch from this window only. The backend keeps it for 30 min. */
  hide: (id: string) => void
}

export const useWatches = create<WatchStore>((set) => ({
  watches: [],
  upsert: (w) => set((s) => ({ watches: mergeWatch(s.watches, w) })),
  hide: (id) => set((s) => ({ watches: s.watches.filter((w) => w.id !== id) })),
}))
