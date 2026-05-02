// Pure formatting helpers. They do not read global state, so tests can call them directly.

/** Relative time, such as "12 s ago" or "3 h ago". Times are Unix ms. */
export function ago(t: number | null | undefined, now = Date.now()): string {
  if (t == null) return '—'
  const s = Math.max(1, Math.round((now - t) / 1000))
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** Clock time in 24-hour format, such as "14:03:22". */
export function hms(t: number | null | undefined): string {
  if (t == null) return '—'
  return new Date(t).toLocaleTimeString([], { hour12: false })
}

export function dateTime(t: number | null | undefined): string {
  if (t == null) return '—'
  return new Date(t).toLocaleString()
}

/** The first 8 characters of a task ID, like the AWS console shows. */
export function shortId(id: string): string {
  return id.slice(0, 8)
}

/** The task ID at the end of a task ARN. */
export function taskIdFromArn(arn: string): string {
  return arn.split('/').pop() ?? arn
}

/** "family:revision" from a task definition ARN or short name. */
export function taskDefShort(taskDefinition: string): string {
  return taskDefinition.split('/').pop() ?? taskDefinition
}

export function taskDefFamily(taskDefinition: string): string {
  return taskDefShort(taskDefinition).split(':')[0]
}

export function taskDefRevision(taskDefinition: string): number | null {
  const rev = Number(taskDefShort(taskDefinition).split(':')[1])
  return Number.isFinite(rev) ? rev : null
}

/** "RUNNING" becomes "Running". */
export function titleCase(s: string | null | undefined): string {
  if (!s) return '—'
  return s
    .toLowerCase()
    .split('_')
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase())
}

/** Task size from CPU units and memory MiB, such as "1 vCPU · 2 GB". */
export function taskSize(cpu: string | null, memory: string | null): string {
  const c = cpu ? Number(cpu) : NaN
  const m = memory ? Number(memory) : NaN
  const parts: string[] = []
  if (Number.isFinite(c)) parts.push(`${trim(c / 1024)} vCPU`)
  if (Number.isFinite(m)) parts.push(m >= 1024 ? `${trim(m / 1024)} GB` : `${m} MiB`)
  return parts.length ? parts.join(' · ') : '—'
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/** Percent from 0 to 100. Returns 0 when the total is 0. */
export function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.max(0, Math.min(100, (part / total) * 100))
}

/** Account ID in groups of four, such as "1111-2222-3333". */
export function formatAccount(id: string | null | undefined): string {
  if (!id) return '—'
  return id.length === 12 ? `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}` : id
}

/** Account ID from an ARN such as "arn:aws:ecs:us-east-1:123456789012:cluster/x". */
export function accountFromArn(arn: string): string | null {
  return arn.split(':')[4] || null
}

export function serviceArn(region: string, account: string, cluster: string, service: string): string {
  return `arn:aws:ecs:${region}:${account}:service/${cluster}/${service}`
}
