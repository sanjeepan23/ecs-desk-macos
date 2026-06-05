// Labels, tones, and advice for stop categories. Pure data and functions only.
// Keep titles and advice in step with src-tauri/src/analysis.rs.

import type { Tone } from '@/lib/status'
import type { StopCategory, StopGroup, StoppedAnalysis } from '@/lib/types'

export interface CategoryMeta {
  label: string
  tone: Tone
  advice: string
  expected: boolean
}

export const CATEGORY_META: Record<StopCategory, CategoryMeta> = {
  outOfMemory: {
    label: 'Out of memory',
    tone: 'crit',
    expected: false,
    advice: 'The container used all of its memory. Raise the task or container memory, or find the leak; the Metrics tab shows the trend.',
  },
  healthCheck: {
    label: 'Failed health checks',
    tone: 'crit',
    expected: false,
    advice:
      'The load balancer or container health check failed. Check the health check path, port, and grace period, and read the logs from the start of the task.',
  },
  imagePull: {
    label: 'Image pull failed',
    tone: 'crit',
    expected: false,
    advice: 'ECS could not pull the image. Check that the image tag exists and that the execution role and network can reach the registry.',
  },
  secrets: {
    label: 'Secrets did not load',
    tone: 'crit',
    expected: false,
    advice: 'ECS could not read a secret or parameter. Check the ARN and that the execution role can read it and decrypt it with KMS.',
  },
  essentialExit: {
    label: 'Essential container exited',
    tone: 'crit',
    expected: false,
    advice: 'An essential container exited, so ECS stopped the task. Read the container logs near the stop time and check the exit code.',
  },
  capacity: {
    label: 'No capacity',
    tone: 'warn',
    expected: false,
    advice: 'ECS found no capacity to place the task. Check the capacity provider, the cluster instances, and the CPU and memory the task asks for.',
  },
  network: {
    label: 'Network setup failed',
    tone: 'warn',
    expected: false,
    advice: 'The task network did not start. Check for free IP addresses in the subnets and for ENI limits.',
  },
  spotInterruption: {
    label: 'Spot interruption',
    tone: 'warn',
    expected: false,
    advice: 'AWS took back the Spot capacity. Add on-demand capacity to the strategy if the service cannot lose tasks.',
  },
  deployment: { label: 'Replaced by a deployment', tone: 'neutral', expected: true, advice: 'A deployment replaced these tasks. This is normal.' },
  scaleIn: { label: 'Scale-in', tone: 'neutral', expected: true, advice: 'The service scaled in and stopped these tasks. This is normal.' },
  userStopped: { label: 'Stopped by a user', tone: 'neutral', expected: true, advice: 'A user or an API call stopped these tasks.' },
  other: { label: 'Other', tone: 'warn', expected: false, advice: 'Open a task to read the full stop reason and container exit codes.' },
}

export function categoryMeta(c: StopCategory | string): CategoryMeta {
  return CATEGORY_META[c as StopCategory] ?? CATEGORY_META.other
}

/** Tone of one group. Expected stops are always neutral. */
export function groupTone(g: StopGroup): Tone {
  return g.expected ? 'neutral' : categoryMeta(g.category).tone
}

export function problemGroups(a: StoppedAnalysis | null | undefined): StopGroup[] {
  return a ? a.groups.filter((g) => !g.expected) : []
}

/** What the Overview card shows: nothing, a one-line note for normal stops only, or the problem card. */
export function summaryMode(a: StoppedAnalysis | null | undefined): 'hidden' | 'quiet' | 'problems' {
  if (!a || a.total === 0) return 'hidden'
  return problemGroups(a).length ? 'problems' : 'quiet'
}

/** "137, 1" or "" when there are no codes. */
export function exitCodesText(codes: number[]): string {
  return codes.join(', ')
}

/** "3 tasks" or "1 task". */
export function taskCount(n: number): string {
  return `${n} ${n === 1 ? 'task' : 'tasks'}`
}
