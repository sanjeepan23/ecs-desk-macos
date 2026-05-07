import type { UnlistenFn } from '@tauri-apps/api/event'

import { on } from './bus'
import { handleData } from './data'
import { handleDeployWatch } from './deploywatch'
import { handleFleet } from './fleet'
import { handleOps } from './ops'
import { handleStopped } from './stopped'

// A handler returns undefined when it does not own the command, and null for a void command.
export async function mockInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  for (const h of [handleData, handleOps, handleStopped, handleDeployWatch, handleFleet]) {
    const r = await h(cmd, args)
    if (r !== undefined) return (r ?? undefined) as T
  }
  throw { kind: 'internal', message: `Mock backend has no handler for ${cmd}` }
}

export async function mockListen<T>(event: string, cb: (p: T) => void): Promise<UnlistenFn> {
  return on(event, (p) => cb(p as T))
}
