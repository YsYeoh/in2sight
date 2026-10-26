import { getTranslations } from 'next-intl/server';
import { PasswordForm } from '@/components/auth/PasswordForm';
import { SignOutOthersButton } from '@/components/auth/SignOutOthersButton';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMfaStatus } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { confirmEnrollAction, disableAction, startEnrollAction } from '@/app/(app)/settings/actions';
import { changePasswordAction, signOutOthersAction } from '@/app/(app)/settings/security-actions';

/** Settings -> Security (Plan 16b): signed-in email, two-factor (unchanged), password, other devices. */
export async function SecuritySection() {
  const [t, ts] = await Promise.all([getTranslations('settings'), getTranslations('auth.security')]);
  const { email } = await requireOwner();
  const status = await getMfaStatus(await createServerSupabase());
  return (
    <div className="grid gap-[var(--gp)]">
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('account.email')}</p>
          <p className="font-medium break-all">{email}</p>
        </CardContent>
      </Card>
      <TwoFactorCard
        enrolled={status.enrolled && status.factorId ? { factorId: status.factorId } : null}
        startEnrollAction={startEnrollAction}
        confirmEnrollAction={confirmEnrollAction}
        disableAction={disableAction}
      />
      <Card>
        <CardHeader>
          <CardTitle>{ts('passwordTitle')}</CardTitle>
          <CardDescription>{ts('passwordHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm action={changePasswordAction} email={email} withCurrent submitLabel={ts('passwordSubmit')} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{ts('sessionsTitle')}</CardTitle>
          <CardDescription>{ts('sessionsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-[var(--gp)]">
          <p className="text-sm text-muted-foreground">{ts('sessionsNote')}</p>
          <SignOutOthersButton action={signOutOthersAction} />
        </CardContent>
      </Card>
    </div>
  );
}
