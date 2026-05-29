import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Loading03Icon, MinusSignIcon, PlusSignIcon } from '@hugeicons/core-free-icons'

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, asAppError } from '@/lib/api'
import type { ServiceSummary, Task } from '@/lib/types'
import { useApp } from '@/store/app'

import { watchService } from '../deploywatch'
import { parseTaskDef, shortTaskDef, shortTaskId } from '../shared/text'
import { capacityText, currentCtx, needsTypedConfirm, parseUnits, serviceRef, taskRef, toastError } from './guard'

export type ActionDialog =
  | { kind: 'deploy'; svc: ServiceSummary }
  | { kind: 'rollback'; svc: ServiceSummary }
  | { kind: 'scale'; svc: ServiceSummary }
  | { kind: 'stop'; task: Task }
  | { kind: 'execProblems'; task: Task; container: string; problems: string[]; pluginPath: string | null }

export const useActionDialog = create<{ dialog: ActionDialog | null; show: (d: ActionDialog) => void; hide: () => void }>(
  (set) => ({
    dialog: null,
    show: (dialog) => set({ dialog }),
    hide: () => set({ dialog: null }),
  }),
)

const MAX_DESIRED = 500

function afterSuccess() {
  useApp
    .getState()
    .refresh()
    .catch(() => {})
}

/** A text box for the typed confirmation. It reports true when the text equals `name`. */
function TypedConfirm({ name, onChange }: { name: string; onChange: (ok: boolean) => void }) {
  const id = useId()
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-sm font-normal">
        Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{name}</span> to confirm
      </Label>
      <Input
        id={id}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="font-mono"
        onChange={(e) => onChange(e.target.value === name)}
        autoFocus
      />
    </div>
  )
}

function Spinner() {
  return <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
}

interface ConfirmProps {
  title: string
  description: ReactNode
  cta: string
  busyCta: string
  danger?: boolean
  /** The name to type when the profile is production. */
  confirmName: string
  children?: ReactNode
  disabled?: boolean
  onConfirm: () => Promise<boolean>
}

function ConfirmDialog({ title, description, cta, busyCta, danger, confirmName, children, disabled, onConfirm }: ConfirmProps) {
  const hide = useActionDialog((s) => s.hide)
  const [typed] = useState(needsTypedConfirm)
  const [typedOk, setTypedOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const canConfirm = !busy && !disabled && (!typed || typedOk)

  const run = async () => {
    if (!canConfirm) return
    setBusy(true)
    const ok = await onConfirm()
    setBusy(false)
    if (ok) hide()
  }

  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && hide()}>
      <AlertDialogContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {children}
          {typed && <TypedConfirm name={confirmName} onChange={setTypedOk} />}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" variant={danger ? 'destructive' : 'default'} disabled={!canConfirm} autoFocus={!typed}>
              {busy && <Spinner />}
              {busy ? busyCta : cta}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function DeployDialog({ svc }: { svc: ServiceSummary }) {
  return (
    <ConfirmDialog
      title={`Force a new deployment of ${svc.name}?`}
      description={`ECS starts ${svc.desired} new tasks with ${svc.taskDefinitionShort}, then stops the old tasks.`}
      cta="Deploy"
      busyCta="Deploying"
      confirmName={svc.name}
      onConfirm={async () => {
        const ctx = currentCtx()
        if (!ctx) return false
        try {
          const res = await api.forceDeploy(serviceRef(ctx, svc))
          toast.success(`Deploying ${res.name}`, { description: `${res.taskDefinitionShort} · ${res.desired} tasks` })
          afterSuccess()
          watchService(serviceRef(ctx, svc))
          return true
        } catch (e) {
          toastError(`Could not deploy ${svc.name}`, asAppError(e))
          return false
        }
      }}
    />
  )
}

interface Revision {
  value: string
  short: string
  revision: number | null
}

function toRevision(td: string): Revision {
  return { value: td, short: shortTaskDef(td), revision: parseTaskDef(td).revision }
}

function RollbackDialog({ svc }: { svc: ServiceSummary }) {
  const current = parseTaskDef(svc.taskDefinition)
  const [revs, setRevs] = useState<Revision[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    const ctx = currentCtx()
    if (!ctx) return
    let live = true
    api
      .listTaskDefinitionRevisions(ctx.profile, ctx.region, current.family)
      .then((list) => list.map(toRevision))
      .catch((e) => {
        // Fall back to the revision before the current one.
        setNote(`Could not list revisions: ${asAppError(e).message}`)
        const prev = (current.revision ?? 0) - 1
        return prev > 0 ? [toRevision(`${current.family}:${prev}`)] : []
      })
      .then((list) => {
        if (!live) return
        const others = list
          .filter((r) => r.revision !== current.revision)
          .sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0))
        setRevs(others)
        const prev = others.find((r) => current.revision == null || (r.revision ?? 0) < current.revision) ?? others[0]
        setSelected(prev?.value ?? '')
      })
    return () => {
      live = false
    }
  }, [current.family, current.revision])

  const target = revs?.find((r) => r.value === selected)

  return (
    <ConfirmDialog
      title={`Roll back ${svc.name}?`}
      description={`ECS replaces the ${svc.running} running tasks of ${svc.taskDefinitionShort} with the revision you select.`}
      cta="Roll back"
      busyCta="Rolling back"
      danger
      confirmName={svc.name}
      disabled={!target}
      onConfirm={async () => {
        const ctx = currentCtx()
        if (!ctx || !target) return false
        try {
          const res = await api.rollbackService(serviceRef(ctx, svc), target.value)
          toast.success(`Rolling back ${res.name}`, { description: `Target revision ${res.taskDefinitionShort}` })
          afterSuccess()
          watchService(serviceRef(ctx, svc))
          return true
        } catch (e) {
          toastError(`Could not roll back ${svc.name}`, asAppError(e))
          return false
        }
      }}
    >
      <div className="grid gap-2">
        <Label className="text-sm">Target revision</Label>
        {revs == null ? (
          <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading revisions
          </div>
        ) : revs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other revision of {current.family} exists.</p>
        ) : (
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="w-full font-mono">
              <SelectValue placeholder="Select a revision" />
            </SelectTrigger>
            <SelectContent>
              {revs.map((r) => (
                <SelectItem key={r.value} value={r.value} className="font-mono">
                  {r.short}
                  {current.revision != null && r.revision === current.revision - 1 ? '  (previous)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
    </ConfirmDialog>
  )
}

function StopDialog({ task }: { task: Task }) {
  const id8 = shortTaskId(task.id || task.arn)
  return (
    <ConfirmDialog
      title={`Stop task ${id8}?`}
      description={
        task.serviceName
          ? `ECS stops this task. The ${task.serviceName} service then starts a new task to keep its desired count.`
          : 'ECS stops this task. No service replaces it.'
      }
      cta="Stop task"
      busyCta="Stopping"
      danger
      confirmName={task.serviceName ?? id8}
      onConfirm={async () => {
        const ctx = currentCtx()
        if (!ctx) return false
        try {
          await api.stopTask(taskRef(ctx, task), 'Stopped by user from ECS Desk.')
          toast.success(`Stopping task ${id8}`, {
            description: task.serviceName ? `${task.serviceName} starts a new task to replace it.` : undefined,
          })
          afterSuccess()
          return true
        } catch (e) {
          toastError(`Could not stop task ${id8}`, asAppError(e))
          return false
        }
      }}
    />
  )
}

/** Finds the CPU units and memory (MiB) of one task of the service. */
function useTaskSize(svc: ServiceSummary): { cpu: number; mem: number } | null {
  const tasks = useApp((s) => s.tasks)
  const fromTasks = useMemo(() => {
    const t = tasks.find((x) => x.serviceName === svc.name && x.clusterName === svc.clusterName && x.cpu && x.memory)
    const cpu = parseUnits(t?.cpu, 'cpu')
    const mem = parseUnits(t?.memory, 'memory')
    return cpu && mem ? { cpu, mem } : null
  }, [tasks, svc.name, svc.clusterName])
  const [fromDef, setFromDef] = useState<{ cpu: number; mem: number } | null>(null)

  useEffect(() => {
    if (fromTasks) return
    const ctx = currentCtx()
    if (!ctx) return
    let live = true
    api
      .getTaskDefinition(ctx.profile, ctx.region, svc.taskDefinition)
      .then((td) => {
        // The backend can return the task definition itself, or the DescribeTaskDefinition output.
        const def = (td.taskDefinition as Record<string, unknown> | undefined) ?? td
        const cpu = parseUnits(def.cpu as string | number | null, 'cpu')
        const mem = parseUnits(def.memory as string | number | null, 'memory')
        if (live && cpu && mem) setFromDef({ cpu, mem })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [fromTasks, svc.taskDefinition])

  return fromTasks ?? fromDef
}

function ScaleDialog({ svc }: { svc: ServiceSummary }) {
  const hide = useActionDialog((s) => s.hide)
  const [text, setText] = useState(String(svc.desired))
  const [busy, setBusy] = useState(false)
  const [typedOk, setTypedOk] = useState(false)
  const size = useTaskSize(svc)
  const inputId = useId()

  const parsed = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_DESIRED
  const value = valid ? parsed : svc.desired
  const scalingDown = valid && parsed < svc.desired
  // Scale down stops tasks, so production asks for the typed name.
  const typed = scalingDown && needsTypedConfirm()
  const canSave = valid && !busy && parsed !== svc.desired && (!typed || typedOk)

  const step = (d: number) => setText(String(Math.max(0, Math.min(MAX_DESIRED, value + d))))

  const save = async () => {
    if (!canSave) return
    const ctx = currentCtx()
    if (!ctx) return
    setBusy(true)
    try {
      const res = await api.scaleService(serviceRef(ctx, svc), parsed)
      toast.success(`Scaled ${res.name} to ${res.desired} tasks`, { description: `Was ${svc.desired}.` })
      afterSuccess()
      watchService(serviceRef(ctx, svc))
      hide()
    } catch (e) {
      toastError(`Could not scale ${svc.name}`, asAppError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && hide()}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <DialogHeader>
            <DialogTitle>Scale {svc.name}</DialogTitle>
            <DialogDescription>Set the desired task count. It is {svc.desired} now.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={inputId}>Desired tasks</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="icon-lg" onClick={() => step(-1)} disabled={value <= 0} aria-label="Decrease">
                <HugeiconsIcon icon={MinusSignIcon} />
              </Button>
              <Input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_DESIRED}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onFocus={(e) => e.target.select()}
                aria-invalid={!valid}
                className="h-10 w-24 text-center text-base tabular-nums"
                autoFocus
              />
              <Button type="button" variant="outline" size="icon-lg" onClick={() => step(1)} disabled={value >= MAX_DESIRED} aria-label="Increase">
                <HugeiconsIcon icon={PlusSignIcon} />
              </Button>
              {size && <span className="ml-1 text-sm text-muted-foreground tabular-nums">{capacityText(value, size.cpu, size.mem)}</span>}
            </div>
            {!valid && <p className="text-xs text-destructive">Enter a whole number from 0 to {MAX_DESIRED}.</p>}
            {valid && parsed === 0 && <p className="text-xs text-muted-foreground">At 0, ECS stops all tasks of this service.</p>}
          </div>
          {typed && <TypedConfirm name={svc.name} onChange={setTypedOk} />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={hide} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {busy && <Spinner />}
              {busy ? 'Saving' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

