import { useCallback, useEffect, useRef, useState } from 'react'

import { asAppError } from '@/lib/api'
import type { AppError } from '@/lib/types'
import { useApp } from '@/store/app'

export interface AsyncState<T> {
  data: T | null
  error: AppError | null
  loading: boolean
  reload: () => void
}

/**
 * Loads data on demand. It runs again when `deps` change, and it drops stale results.
 * Pass `null` as `fn` to skip the load.
 */
export function useAsync<T>(fn: (() => Promise<T>) | null, deps: unknown[], opts: { toast?: boolean } = {}): AsyncState<T> {
  const [state, setState] = useState<{ data: T | null; error: AppError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!fn,
  })
  const [nonce, setNonce] = useState(0)
  const seq = useRef(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    const f = fnRef.current
    if (!f) {
      setState({ data: null, error: null, loading: false })
      return
    }
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true }))
    f().then(
      (data) => id === seq.current && setState({ data, error: null, loading: false }),
      (e) => {
        if (id !== seq.current) return
        const err = opts.toast ? useApp.getState().report(e) : asAppError(e)
        setState({ data: null, error: err, loading: false })
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}
