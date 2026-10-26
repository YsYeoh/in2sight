import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PasswordForm } from '@/components/auth/PasswordForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { hasRecoveryProof } from '@/lib/auth/recovery';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { resetPasswordAction } from '@/app/login/reset/actions';

// Plan 16a: Settings → Security lives at /settings/security
const SECURITY_HREF = '/settings/security';

export default async function ResetPage() {
  const t = await getTranslations('auth.reset');
  const { email } = await requireOwner(); // signed out → /login, 2FA owed → /login/verify, not the owner → /auth/signout
  const fresh = await hasRecoveryProof(await createServerSupabase());
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{fresh ? t('title') : t('expiredTitle')}</CardTitle>
          <CardDescription>{fresh ? t('hint') : t('expiredBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          {fresh ? (
            <PasswordForm action={resetPasswordAction} email={email} withCurrent={false} submitLabel={t('submit')} />
          ) : (
            <Link href={SECURITY_HREF} className="text-sm underline underline-offset-4">
              {t('toSettings')}
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
