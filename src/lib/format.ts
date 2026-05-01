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

