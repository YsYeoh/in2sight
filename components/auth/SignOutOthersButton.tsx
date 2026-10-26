'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';

/** Signs out every session of the owner except this one (Supabase `signOut({ scope: 'others' })`). */
export function SignOutOthersButton({ action }: { action: () => Promise<{ ok: boolean }> }) {
  const t = useTranslations('auth.security');
  const [result, setResult] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setResult(null);
      setResult((await action()).ok);
    });
  return (
    <div className="flex flex-col items-start gap-[var(--gp)]">
      <LoadingButton type="button" variant="outline" pending={pending} onClick={run}>
        {t('signOutOthers')}
      </LoadingButton>
      {result === true ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('signedOutOthers')}
        </p>
      ) : null}
      {result === false ? (
        <p role="alert" className="text-xs text-destructive">
          {t('signOutOthersFailed')}
        </p>
      ) : null}
    </div>
  );
}
