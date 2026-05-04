// Splits pretty-printed JSON into colored parts for the task definition view.

export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'plain'

export interface JsonToken {
  text: string
  kind: JsonTokenKind
}

const RE = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|\b(true|false|null)\b/g

export function tokenizeJson(src: string): JsonToken[] {
  const out: JsonToken[] = []
  let last = 0
  for (const m of src.matchAll(RE)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: src.slice(last, i), kind: 'plain' })
    if (m[1]) {
      out.push({ text: m[1], kind: m[2] ? 'key' : 'string' })
      if (m[2]) out.push({ text: m[2], kind: 'plain' })
    } else if (m[3]) out.push({ text: m[3], kind: 'number' })
    else out.push({ text: m[4], kind: 'literal' })
    last = i + m[0].length
  }
  if (last < src.length) out.push({ text: src.slice(last), kind: 'plain' })
  return out
}
