import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAllowActions } from '@/hooks/useAllowActions'
import { useApp } from '@/store/app'

/** Confirms before a profile leaves read-only mode. Mount once at the root. */
export function AllowActionsDialog() {
  const profile = useAllowActions((s) => s.profile)
  const close = useAllowActions((s) => s.close)
  const setReadOnly = useApp((s) => s.setReadOnly)
  const isProd = useApp((s) => s.profiles.find((p) => p.name === profile)?.isProd ?? false)
  return (
    <AlertDialog open={!!profile} onOpenChange={(o) => !o && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Allow actions on {profile}?</AlertDialogTitle>
          <AlertDialogDescription>
            Deploy, scale, stop, and exec will work for this profile. {isProd ? 'This is a production profile. ' : ''}You can turn read-only on
            again in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (profile) void setReadOnly(profile, false)
              close()
            }}
          >
            Allow actions
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
