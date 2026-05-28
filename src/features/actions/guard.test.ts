import { describe, expect, it } from 'vitest'

import { capacityText, parseUnits } from './guard'

describe('parseUnits', () => {
  it('reads numbers and unit strings', () => {
    expect(parseUnits('512', 'cpu')).toBe(512)
    expect(parseUnits('1 vCPU', 'cpu')).toBe(1024)
    expect(parseUnits('2 GB', 'memory')).toBe(2048)
    expect(parseUnits(1024, 'memory')).toBe(1024)
    expect(parseUnits(null, 'cpu')).toBeNull()
    expect(parseUnits('abc', 'cpu')).toBeNull()
  })
})

describe('capacityText', () => {
  it('totals vCPU and GB for a task count', () => {
    expect(capacityText(4, 512, 1024)).toBe('2 vCPU · 4 GB total')
    expect(capacityText(3, 256, 512)).toBe('0.8 vCPU · 1.5 GB total')
  })
})
