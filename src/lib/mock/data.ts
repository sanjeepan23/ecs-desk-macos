// Mock handlers for settings, profiles, ECS reads, and polling.
// Return undefined for a command this file does not handle, and null for a void command.
//
// The features agent may import these exports read-only from './data':
// world, findService, findTask, makeTask, addEvent, recompute, emitNow, isReadOnly, mockSettings,
// accountOf, taskDefinitionJson, mockError, checkSession, mockControls.

import type {
  AppError,
  AuthKind,
  ClusterSummary,
  Container,
  Deployment,
  EcsUpdate,
  Focus,
  PollStatus,
  Profile,
  ServiceDetail,
  ServiceEvent,
  ServiceSummary,
  Settings,
  Task,
} from '../types'
import { EVENTS } from '../types'
import { delay, emit } from './bus'

/* ---------- Seeded random ---------- */

export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

export const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('')

/* ---------- Example world (same as docs/ui-mock.html) ---------- */

