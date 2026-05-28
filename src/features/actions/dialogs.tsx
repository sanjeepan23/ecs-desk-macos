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

