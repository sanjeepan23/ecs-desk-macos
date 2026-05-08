import { useEffect, useState } from 'react'

import { useApp } from '@/store/app'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

/** True when the page shows the dark theme. */
export function useIsDark(): boolean {
  const theme = useApp((s) => s.settings?.theme ?? 'system')
  const [systemDark, setSystemDark] = useState(() => media().matches)
  useEffect(() => {
    const m = media()
    const on = () => setSystemDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/** Sets the `dark` class on <html> from settings.theme. Mount once at the root. */
export function useApplyTheme() {
  const dark = useIsDark()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  return dark
}
