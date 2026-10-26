'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import type { ConfirmState } from '@/lib/auth/recovery';

/** One button that POSTs the emailed token hash: a GET (mail scanners) never uses the one-time link. */
export function RecoveryConfirmForm({ action, tokenHash }: { action: (prev: ConfirmState, formData: FormData) => Promise<ConfirmState>; tokenHash: string }) {
  const t = useTranslations('auth.confirm');
  const [state, formAction, pending] = useActionState(action, {} as ConfirmState);
  return (
    <form action={formAction} className="flex flex-col gap-[var(--gp)]">
      <input type="hidden" name="token_hash" value={tokenHash} />
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(state.error)}{' '}
          <Link href="/login/forgot" className="underline underline-offset-4">
            {t('requestNew')}
          </Link>
        </p>
      ) : null}
      <LoadingButton type="submit" pending={pending} className="w-full">
        {t('submit')}
      </LoadingButton>
    </form>
  );
}
