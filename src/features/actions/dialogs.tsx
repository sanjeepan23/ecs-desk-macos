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

