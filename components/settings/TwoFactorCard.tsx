'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Enroll = { ok: true; factorId: string; qrSvg: string; secret: string } | { ok: false };
interface Props {
  enrolled: { factorId: string } | null;
  startEnrollAction: () => Promise<Enroll>;
  confirmEnrollAction: (factorId: string, code: string) => Promise<{ ok: boolean; error?: string }>;
  disableAction: (factorId: string) => Promise<{ ok: boolean }>;
}

export function TwoFactorCard({ enrolled, startEnrollAction, confirmEnrollAction, disableAction }: Props) {
  const t = useTranslations('settings.twoFactor');
  const tv = useTranslations('auth.verify');
  const te = useTranslations('auth.errors');
  // the secret lives only in this state: dropped on cancel and on success, never stored
  const [enroll, setEnroll] = useState<Extract<Enroll, { ok: true }> | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => {
    setEnroll(null);
    setCode('');
    setError(null);
  };

  const begin = () =>
    start(async () => {
      setError(null);
      const r = await startEnrollAction();
      if (r.ok) setEnroll(r);
      else setError(t('errorUnexpected'));
    });

  const confirm = () =>
    start(async () => {
      if (!enroll) return;
      const r = await confirmEnrollAction(enroll.factorId, code);
      if (r.ok) reset();
      else setError(r.error === 'invalid_code' ? te('invalid_code') : r.error === 'rate_limited' ? te('rate_limited') : t('errorUnexpected'));
    });

  const disable = (factorId: string) =>
    start(async () => {
      setError(null);
      const r = await disableAction(factorId);
      if (!r.ok) setError(t('errorUnexpected'));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('title')}
          {enrolled ? <Badge variant="secondary">{t('enabled')}</Badge> : null}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--gp)]">
        {enrolled ? (
          <>
            <p className="text-xs text-muted-foreground">{t('recovery')}</p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="self-start">
                  {t('disable')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('disableTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('disableBody')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => disable(enrolled.factorId)}>{t('disable')}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : enroll ? (
          <form
            className="flex flex-col gap-[var(--gp)]"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            <p className="text-sm">{t('scan')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase, not an optimisable asset */}
            <img src={enroll.qrSvg} alt={t('qrAlt')} className="size-44 rounded-md border border-border bg-white p-2" />
            <p className="text-xs text-muted-foreground">
              {t('secret')} <code className="break-all font-mono text-foreground">{enroll.secret}</code>
            </p>
            <FormField id="totp-code" label={tv('code')}>
              {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />}
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {t('confirm')}
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button onClick={begin} disabled={pending} className="self-start">
            {t('enable')}
          </Button>
        )}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
