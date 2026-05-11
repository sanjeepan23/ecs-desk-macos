import { useMemo } from 'react'

import { tokenizeJson, type JsonTokenKind } from '@/lib/json'

const CLS: Record<JsonTokenKind, string | undefined> = {
  key: 'text-info',
  string: 'text-ok',
  number: 'text-warn',
  literal: 'text-warn',
  plain: undefined,
}

export function JsonView({ value }: { value: unknown }) {
  const tokens = useMemo(() => tokenizeJson(JSON.stringify(value, null, 2)), [value])
  return (
    <pre className="max-h-[520px] overflow-auto rounded-2xl border bg-muted px-4 py-3.5 font-mono text-xs leading-relaxed">
      {tokens.map((t, i) => (
        <span key={i} className={CLS[t.kind]}>
          {t.text}
        </span>
      ))}
    </pre>
  )
}
