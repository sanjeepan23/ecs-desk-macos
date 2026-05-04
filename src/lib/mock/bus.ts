// In-memory event bus for the browser mock backend.

type Handler = (payload: unknown) => void
const handlers = new Map<string, Set<Handler>>()

export function emit(event: string, payload: unknown) {
  handlers.get(event)?.forEach((h) => h(payload))
}

export function on(event: string, h: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(h)
  return () => handlers.get(event)?.delete(h)
}

export const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))
