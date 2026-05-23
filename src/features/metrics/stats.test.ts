import { describe, expect, it } from 'vitest'

import { fmtPct, isNearLimit, prepareSeries, seriesStats } from './stats'

describe('seriesStats', () => {
  it('computes now, avg, and max', () => {
    expect(seriesStats([{ t: 1, v: 10 }, { t: 2, v: 30 }, { t: 3, v: 20 }])).toEqual({ now: 20, avg: 20, max: 30 })
  })
  it('returns nulls for an empty series', () => {
    expect(seriesStats([])).toEqual({ now: null, avg: null, max: null })
  })
})

describe('prepareSeries', () => {
  it('sorts by time, clamps to 0–100, and drops bad points', () => {
    expect(prepareSeries([{ t: 3, v: 120 }, { t: 1, v: -5 }, { t: 2, v: Number.NaN }])).toEqual([
      { t: 1, v: 0 },
      { t: 3, v: 100 },
    ])
  })
})

describe('limits and format', () => {
  it('flags memory above 90%', () => {
    expect(isNearLimit({ now: 50, avg: 50, max: 90 })).toBe(false)
    expect(isNearLimit({ now: 50, avg: 50, max: 90.1 })).toBe(true)
  })
  it('formats percentages', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(12.345)).toBe('12.3%')
  })
})
