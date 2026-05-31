import { describe, expect, it } from 'vitest'

import { filterItems, GROUP_LIMIT, groupItems, type PaletteItem } from './items'

const item = (id: string, group: PaletteItem['group'], label: string, hint?: string, keywords?: string[]): PaletteItem => ({
  id,
  group,
  label,
  hint,
  keywords,
  run: () => {},
})

const items: PaletteItem[] = [
  item('a', 'Actions', 'Refresh now'),
  item('g', 'Go to', 'Services'),
  item('s1', 'Services', 'orders-api', 'core-prod'),
  item('s2', 'Services', 'api-gateway', 'core-prod'),
  item('s3', 'Services', 'payments-worker', 'core-prod', ['payments-worker:58']),
  item('c1', 'Clusters', 'core-prod'),
]

describe('filterItems', () => {
  it('returns items in group order for an empty query', () => {
    expect(filterItems(items, '').map((i) => i.id)).toEqual(['g', 's1', 's2', 's3', 'c1', 'a'])
  })
  it('needs every word to match label, hint, or keywords', () => {
    expect(filterItems(items, 'api core').map((i) => i.id)).toEqual(['s1', 's2'])
    expect(filterItems(items, ':58').map((i) => i.id)).toEqual(['s3'])
    expect(filterItems(items, 'nothing')).toEqual([])
  })
  it('ranks label prefix matches first in a group', () => {
    expect(filterItems(items, 'api').map((i) => i.id)).toEqual(['s2', 's1'])
  })
  it('limits the items per group', () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`t${i}`, 'Tasks', `task${i}`))
    expect(filterItems(many, '').length).toBe(GROUP_LIMIT.empty)
    expect(filterItems(many, 'task').length).toBe(GROUP_LIMIT.query)
  })
})

describe('groupItems', () => {
  it('drops empty groups', () => {
    expect(groupItems(filterItems(items, 'core')).map(([g]) => g)).toEqual(['Services', 'Clusters'])
  })
})
