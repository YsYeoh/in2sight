import { getTranslations } from 'next-intl/server';
import { confirmEnrollAction, disableAction, startEnrollAction } from '@/app/(app)/settings/actions';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { Card, CardContent } from '@/components/ui/card';
import { getMfaStatus } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';

/**
 * Settings -> Security. Plan 16a moved today's Account tab here unchanged so two-factor never disappears.
 * Plan 16b REPLACES this file (same file name, same export, zero props) and adds change password and sessions.
 */
export async function SecuritySection() {
  const t = await getTranslations('settings');
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
    </div>
  );
}
