import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { RecoveryConfirmForm } from '@/components/auth/RecoveryConfirmForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { isTokenHash } from '@/lib/auth/recovery';
import { confirmRecoveryAction } from '@/app/auth/confirm/actions';

// the token hash is in this page's URL: never send it on as a Referer, never index the page
export const metadata: Metadata = { referrer: 'no-referrer', robots: { index: false, follow: false } };

/** GET only renders a button (mail scanners that pre-open links cannot burn the one-time token). Only `token_hash` and `type` are read. */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations('auth.confirm');
  const sp = await searchParams;
  const tokenHash = typeof sp.token_hash === 'string' ? sp.token_hash : '';
  const valid = sp.type === 'recovery' && isTokenHash(tokenHash);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{valid ? t('hint') : t('link_invalid')}</CardDescription>
        </CardHeader>
        <CardContent>
          {valid ? (
            <RecoveryConfirmForm action={confirmRecoveryAction} tokenHash={tokenHash} />
          ) : (
            <Link href="/login/forgot" className="text-sm underline underline-offset-4">
              {t('requestNew')}
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
