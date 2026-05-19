import { describe, expect, it } from 'vitest'

import { cleanLogMessage, includesCI, parseTaskDef, shortTaskDef, shortTaskId, splitHighlight, stripAnsi, truncate } from './text'

describe('stripAnsi', () => {
  it('removes color and cursor codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m and \x1b[1;32mgreen\x1b[0m')).toBe('red and green')
    expect(stripAnsi('\x1b[2J\x1b[Hclear')).toBe('clear')
  })
  it('removes OSC title sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text')
  })
  it('keeps text without codes', () => {
    expect(stripAnsi('plain — ünïcode 🚀')).toBe('plain — ünïcode 🚀')
  })
})

describe('cleanLogMessage', () => {
  it('drops trailing line breaks and control characters, and keeps tabs', () => {
    expect(cleanLogMessage('a\tb\u0000c\r\n')).toBe('a\tbc')
  })
})

describe('truncate', () => {
  it('does not split a surrogate pair', () => {
    expect(truncate('ab🚀🚀🚀', 4)).toBe('ab🚀…')
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('splitHighlight', () => {
  it('returns one plain segment for an empty query', () => {
    expect(splitHighlight('hello', '  ')).toEqual([{ text: 'hello', match: false }])
  })
  it('splits all matches, case-insensitive', () => {
    expect(splitHighlight('GET /orders get', 'get')).toEqual([
      { text: 'GET', match: true },
      { text: ' /orders ', match: false },
      { text: 'get', match: true },
    ])
  })
  it('treats regex characters as text', () => {
    expect(splitHighlight('a.b(c)', '(c)')).toEqual([
      { text: 'a.b', match: false },
      { text: '(c)', match: true },
    ])
  })
  it('keeps offsets correct for characters that change length in lower case', () => {
    const segs = splitHighlight('İstanbul error', 'error')
    expect(segs.map((s) => s.text).join('')).toBe('İstanbul error')
    expect(segs.find((s) => s.match)?.text).toBe('error')
  })
})

describe('includesCI', () => {
  it('matches case-insensitive and accepts an empty query', () => {
    expect(includesCI('OutOfMemoryError', 'memory')).toBe(true)
    expect(includesCI('abc', '')).toBe(true)
    expect(includesCI('abc', 'x')).toBe(false)
  })
})

describe('task helpers', () => {
  it('shortens IDs and task definitions', () => {
    expect(shortTaskId('arn:aws:ecs:us-east-1:1:task/core/0123456789abcdef')).toBe('01234567')
    expect(shortTaskDef('arn:aws:ecs:us-east-1:1:task-definition/web:12')).toBe('web:12')
    expect(parseTaskDef('arn:aws:ecs:us-east-1:1:task-definition/web-app:12')).toEqual({ family: 'web-app', revision: 12 })
    expect(parseTaskDef('web')).toEqual({ family: 'web', revision: null })
  })
})
