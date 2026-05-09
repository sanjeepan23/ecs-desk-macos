import { Alert02Icon, Login01Icon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { useApp } from '@/store/app'
import { Banner, Icon } from '@/views/parts/ui'

/** Shows on every page while the SSO session of the current profile is expired. */
export function AuthBanner() {
  const profile = useApp((s) => s.profile)
  const expired = useApp((s) => (s.profile ? !!s.authExpired[s.profile] : false))
  const login = useApp((s) => s.login)
  if (!expired || !profile) return null
  return (
    <Banner
      tone="crit"
      icon={Alert02Icon}
      action={
        <Button size="sm" onClick={() => void login(profile)}>
          <Icon icon={Login01Icon} />
          Log in
        </Button>
      }
    >
      <b>Your session for {profile} has expired.</b> <span className="text-muted-foreground">The data on this page can be old.</span>
    </Banner>
  )
}
