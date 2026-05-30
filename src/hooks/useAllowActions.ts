import { create } from 'zustand'

/** Opens the "Allow actions" confirm dialog for a profile. The shell mounts the dialog. */
export const useAllowActions = create<{ profile: string | null; request: (profile: string) => void; close: () => void }>((set) => ({
  profile: null,
  request: (profile) => set({ profile }),
  close: () => set({ profile: null }),
}))
