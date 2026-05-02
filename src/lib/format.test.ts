import { describe, expect, it } from 'vitest'

import { ago, formatAccount, pct, shortId, taskDefFamily, taskDefRevision, taskDefShort, taskIdFromArn, taskSize, titleCase } from './format'

describe('ago', () => {
  const now = 1_700_000_000_000
  it('formats seconds, minutes, hours, and days', () => {
    expect(ago(now - 12_000, now)).toBe('12 s ago')
    expect(ago(now - 4 * 60_000, now)).toBe('4 min ago')
    expect(ago(now - 3 * 3600_000, now)).toBe('3 h ago')
    expect(ago(now - 6 * 86400_000, now)).toBe('6 d ago')
  })
  it('never shows zero seconds, and shows a dash for null', () => {
    expect(ago(now, now)).toBe('1 s ago')
    expect(ago(null, now)).toBe('—')
  })
})

describe('task definition names', () => {
  const arn = 'arn:aws:ecs:us-east-1:111122223333:task-definition/payments-worker:58'
  it('reads the short name, family, and revision', () => {
    expect(taskDefShort(arn)).toBe('payments-worker:58')
    expect(taskDefFamily(arn)).toBe('payments-worker')
    expect(taskDefRevision(arn)).toBe(58)
    expect(taskDefRevision('payments-worker')).toBeNull()
  })
})

describe('ids and text', () => {
  it('reads task ids', () => {
    expect(taskIdFromArn('arn:aws:ecs:us-east-1:1:task/core-prod/abcdef0123456789')).toBe('abcdef0123456789')
    expect(shortId('abcdef0123456789')).toBe('abcdef01')
  })
  it('formats status words and accounts', () => {
    expect(titleCase('RUNNING')).toBe('Running')
    expect(titleCase('IN_PROGRESS')).toBe('In progress')
    expect(formatAccount('111122223333')).toBe('1111-2222-3333')
    expect(formatAccount(null)).toBe('—')
  })
})

describe('taskSize', () => {
  it('formats CPU units and memory', () => {
    expect(taskSize('1024', '2048')).toBe('1 vCPU · 2 GB')
    expect(taskSize('256', '512')).toBe('0.25 vCPU · 512 MiB')
    expect(taskSize(null, null)).toBe('—')
  })
})

describe('pct', () => {
  it('clamps to 0..100 and handles a zero total', () => {
    expect(pct(1, 4)).toBe(25)
    expect(pct(5, 4)).toBe(100)
    expect(pct(1, 0)).toBe(0)
  })
})
