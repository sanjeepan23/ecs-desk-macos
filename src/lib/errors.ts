// Maps AppError kinds to toasts. The texts here are what the user reads, so keep them short.

import { toast } from 'sonner'

import { asAppError } from './api'
import type { AppError } from './types'

export interface ErrorText {
  title: string
  description?: string
}

/** Title and description for an error. Pure, so tests can check the texts. */
export function errorText(e: AppError, profile?: string | null): ErrorText {
  switch (e.kind) {
    case 'auth':
      return { title: profile ? `Your session for ${profile} has expired.` : 'Your AWS session has expired.', description: 'Log in again to continue.' }
    case 'throttled':
      return { title: 'AWS is throttling requests.', description: 'The app slows down polling and tries again.' }
    case 'notFound':
      return { title: 'The resource was not found.', description: e.message }
    case 'readOnly':
      return { title: profile ? `${profile} is read-only.` : 'This profile is read-only.', description: 'Select "Allow actions" or change it in Settings.' }
    case 'invalid':
      return { title: 'The request is not valid.', description: e.message }
    case 'aws':
      return { title: 'AWS returned an error.', description: e.message }
    default:
      return { title: 'Something went wrong.', description: e.message }
  }
}

export interface ReportOptions {
  profile?: string | null
  /** Called by the "Log in" button on auth errors. */
  onLogin?: () => void
}

/** Shows a toast for the error and returns it as an AppError. */
export function reportError(err: unknown, opts: ReportOptions = {}): AppError {
  const e = asAppError(err)
  const { title, description } = errorText(e, opts.profile)
  if (e.kind === 'auth') {
    toast.error(title, {
      id: `auth-${opts.profile ?? ''}`,
      description,
      duration: 10_000,
      action: opts.onLogin ? { label: 'Log in', onClick: opts.onLogin } : undefined,
    })
  } else if (e.kind === 'throttled' || e.kind === 'readOnly') {
    toast.warning(title, { id: e.kind, description })
  } else {
    toast.error(title, { description })
  }
  return e
}
