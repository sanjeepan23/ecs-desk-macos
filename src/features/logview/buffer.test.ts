import { describe, expect, it } from 'vitest'

import type { LogLine } from '@/lib/types'

import { filterRows, LogBuffer, normalizeLevel, sourceLabel } from './buffer'

const line = (t: number, level = 'INFO', message = `m${t}`): LogLine => ({ timestamp: t, level, message, group: '/ecs/a', stream: 'ecs/a/0123456789' })

describe('LogBuffer', () => {
  it('keeps only the newest lines', () => {
    const b = new LogBuffer(3)
    b.append([1, 2, 3, 4, 5].map((t) => line(t)))
    expect(b.snapshot().map((r) => r.timestamp)).toEqual([3, 4, 5])
    expect(b.oldest).toBe(3)
  })
  it('prepends older lines only while there is room', () => {
    const b = new LogBuffer(4)
    b.append([10, 11].map((t) => line(t)))
    expect(b.prepend([5, 6, 7].map((t) => line(t)))).toBe(2)
    expect(b.snapshot().map((r) => r.timestamp)).toEqual([6, 7, 10, 11])
    expect(b.prepend([1].map((t) => line(t)))).toBe(0)
  })
  it('gives each row a unique ID', () => {
    const b = new LogBuffer(10)
    b.append([line(1), line(1)])
    b.prepend([line(0)])
    const ids = b.snapshot().map((r) => r.id)
    expect(new Set(ids).size).toBe(3)
  })
  it('cleans ANSI codes from messages', () => {
    const b = new LogBuffer()
    b.append([line(1, 'INFO', '\x1b[32mok\x1b[0m\n')])
    expect(b.snapshot()[0].message).toBe('ok')
  })
})

describe('normalizeLevel', () => {
  it('maps common spellings', () => {
    expect(normalizeLevel('warning')).toBe('WARN')
    expect(normalizeLevel('err')).toBe('ERROR')
    expect(normalizeLevel('FATAL')).toBe('ERROR')
    expect(normalizeLevel('trace')).toBe('DEBUG')
    expect(normalizeLevel('info')).toBe('INFO')
  })
  it('looks in the message when the level is unknown', () => {
    expect(normalizeLevel('', 'java.lang.OutOfMemoryError: ERROR here')).toBe('ERROR')
    expect(normalizeLevel(null, 'plain text')).toBe('INFO')
  })
})

