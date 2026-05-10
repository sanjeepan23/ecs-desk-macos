// Table with click-to-sort headers. Long lists render only the visible rows.

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'

import { cn } from '@/lib/utils'

import { EmptyState, Icon } from './ui'

export interface Column<T> {
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Value to sort by. Columns without it do not sort. */
  sort?: (row: T) => string | number | null
  className?: string
}

export interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  empty?: ReactNode
  /** Lists longer than this render only the visible rows. */
  virtualizeAbove?: number
  /** Max height in px of the scroll area for long lists. */
  maxHeight?: number
  defaultSort?: { id: string; desc?: boolean }
}

const ROW_H = 41

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowLabel,
  empty = 'Nothing to show.',
  virtualizeAbove = 60,
  maxHeight = 600,
  defaultSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ id: string; desc?: boolean } | null>(defaultSort ?? null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.id === sort.id)
    if (!col?.sort) return rows
    const get = col.sort
    const dir = sort.desc ? -1 : 1
    return [...rows].sort((a, b) => {
      const x = get(a)
      const y = get(b)
      if (x == null) return 1
      if (y == null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [rows, columns, sort])

  const virtual = sorted.length > virtualizeAbove
  const v = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    enabled: virtual,
  })

  if (!rows.length) return <EmptyState>{empty}</EmptyState>

  const items = virtual ? v.getVirtualItems() : null
  const visible = items ? items.map((it) => ({ row: sorted[it.index], index: it.index })) : sorted.map((row, index) => ({ row, index }))
  const padTop = items?.length ? items[0].start : 0
  const padBottom = items?.length ? v.getTotalSize() - items[items.length - 1].end : 0

  const toggleSort = (id: string) =>
    setSort((s) => (s?.id === id ? (s.desc ? null : { id, desc: true }) : { id, desc: false }))

  const onKey = (e: KeyboardEvent, row: T) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick?.(row)
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-auto rounded-2xl border bg-card"
      style={virtual ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c) => {
              const active = sort?.id === c.id
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={active ? (sort?.desc ? 'descending' : 'ascending') : undefined}
                  className={cn('bg-muted px-3.5 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground', c.className)}
                >
                  {c.sort ? (
                    <button type="button" className="inline-flex items-center gap-1 rounded-sm hover:text-foreground" onClick={() => toggleSort(c.id)}>
                      {c.header}
                      {active && <Icon icon={sort?.desc ? ArrowDown01Icon : ArrowUp01Icon} size={12} />}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length} style={{ height: padTop, padding: 0 }} />
            </tr>
          )}
          {visible.map(({ row, index }) => (
            <tr
              key={rowKey(row)}
              data-index={index}
              ref={virtual ? v.measureElement : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={rowLabel?.(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
              className={cn('border-t', onRowClick && 'cursor-pointer outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset')}
            >
              {columns.map((c) => (
                <td key={c.id} className={cn('px-3.5 py-2.5 align-middle whitespace-nowrap', c.className)}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {padBottom > 0 && (
            <tr aria-hidden>
              <td colSpan={columns.length} style={{ height: padBottom, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/** Stops a click inside a row (for example on a menu button) from opening the row. */
export function StopRowClick({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}
