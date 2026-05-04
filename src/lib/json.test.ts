import { describe, expect, it } from 'vitest'

import { tokenizeJson } from './json'

describe('tokenizeJson', () => {
  it('marks keys, strings, numbers, and literals, and keeps all text', () => {
    const src = JSON.stringify({ family: 'api', revision: 3, essential: true, x: null }, null, 2)
    const tokens = tokenizeJson(src)
    expect(tokens.map((t) => t.text).join('')).toBe(src)
    expect(tokens.filter((t) => t.kind === 'key').map((t) => t.text)).toEqual(['"family"', '"revision"', '"essential"', '"x"'])
    expect(tokens.find((t) => t.kind === 'string')?.text).toBe('"api"')
    expect(tokens.find((t) => t.kind === 'number')?.text).toBe('3')
    expect(tokens.filter((t) => t.kind === 'literal').map((t) => t.text)).toEqual(['true', 'null'])
  })
  it('does not color digits inside strings', () => {
    const tokens = tokenizeJson('{"image": "repo:v58.0.2"}')
    expect(tokens.some((t) => t.kind === 'number')).toBe(false)
  })
})
