'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { vapidKeyBytes } from '@/lib/push/subscription';
import { isIos, isStandalone } from '@/lib/pwa';

type Result = { ok: boolean };
type Status = 'checking' | 'dev-only' | 'unsupported' | 'ios-install' | 'not-configured' | 'denied' | 'off' | 'on';

export interface NotificationsCardProps {
  vapidPublicKey: string | null;
  /** Same production-only flag as <ServiceWorker>: in dev the worker is never registered, so push can't work. */
  swEnabled: boolean;
  save: (subscription: unknown, userAgent: string) => Promise<Result>;
  remove: (endpoint: string) => Promise<Result>;
  /** "Send a test notification" to this device (Plan 16a); omitted = no button */
  test?: (endpoint: string) => Promise<{ ok: boolean; error?: string }>;
}

const TEST_ERRORS = ['not_configured', 'gone', 'failed', 'invalid', 'unexpected'] as const;

export function NotificationsCard({ vapidPublicKey, swEnabled, save, remove, test }: NotificationsCardProps) {
  const t = useTranslations('settings.notifications');
  const router = useRouter();
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();
  const [tested, setTested] = useState<{ ok: true } | { ok: false; key: (typeof TEST_ERRORS)[number] } | null>(null);

  useEffect(() => {
    let alive = true;
    const set = (s: Status) => alive && setStatus(s);
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return set(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      if (!swEnabled) return set('dev-only');
      if (!vapidPublicKey) return set('not-configured');
      if (Notification.permission === 'denied') return set('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      set((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => set('off'));
    return () => {
      alive = false;
    };
  }, [vapidPublicKey, swEnabled]);

  // permission is requested ONLY here, from the explicit button (SPEC §7c)
  const enable = () =>
    start(async () => {
      setError(false);
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return setStatus(permission === 'denied' ? 'denied' : 'off');
        if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register('/sw.js');
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(vapidPublicKey!) });
        const r = await save(sub.toJSON(), navigator.userAgent);
        if (!r.ok) {
          await sub.unsubscribe().catch(() => false); // not stored: don't leave a subscription nobody sends to
          return setError(true);
        }
        setStatus('on');
      } catch {
        setError(true);
      }
    });

  const sendTest = () =>
    startTest(async () => {
      setTested(null);
      try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (!sub || !test) return setTested({ ok: false, key: 'invalid' });
        const r = await test(sub.endpoint);
        if (r.error === 'gone') {
          // the push service dropped this subscription and the server pruned its row: make the browser agree, re-read the devices
          await sub.unsubscribe().catch(() => false);
          setStatus('off');
          router.refresh();
        }
        const key = (TEST_ERRORS as readonly string[]).includes(r.error ?? '') ? (r.error as (typeof TEST_ERRORS)[number]) : 'unexpected';
        setTested(r.ok ? { ok: true } : { ok: false, key });
      } catch {
        setTested({ ok: false, key: 'unexpected' });
      }
    });

  const disable = () =>
    start(async () => {
      setError(false);
      setTested(null);
      try {
        const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
        if (sub) {
          if (!(await remove(sub.endpoint)).ok) return setError(true); // keep the browser subscription so both sides still agree
          await sub.unsubscribe();
        }
        setStatus('off');
      } catch {
        setError(true);
      }
    });

  const note = (key: 'checking' | 'devOnly' | 'unsupported' | 'iosInstall' | 'notConfigured' | 'denied') => <p className="text-sm text-muted-foreground">{t(key)}</p>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('pushTitle')}
          {status === 'on' ? <Badge variant="secondary">{t('on')}</Badge> : null}
        </CardTitle>
        <CardDescription>{t('pushDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--gp)]">
        {status === 'checking' ? note('checking') : null}
        {status === 'dev-only' ? note('devOnly') : null}
        {status === 'unsupported' ? note('unsupported') : null}
        {status === 'ios-install' ? note('iosInstall') : null}
        {status === 'not-configured' ? note('notConfigured') : null}
        {status === 'denied' ? note('denied') : null}
        {status === 'off' ? (
          <div className="flex flex-col items-start gap-1.5">
            <LoadingButton onClick={enable} pending={pending}>
              {t('enable')}
            </LoadingButton>
            <p className="text-xs text-muted-foreground">{t('enableHint')}</p>
          </div>
        ) : null}
        {status === 'on' ? (
          <div className="flex flex-wrap items-center gap-2">
            <LoadingButton variant="outline" onClick={disable} pending={pending} disabled={testing}>
              {t('disable')}
            </LoadingButton>
            {test ? (
              <LoadingButton variant="outline" onClick={sendTest} pending={testing} disabled={pending}>
                {t('testSend')}
              </LoadingButton>
            ) : null}
          </div>
        ) : null}
        {tested?.ok ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('testSent')}
          </p>
        ) : null}
        {tested && !tested.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {t(`testErrors.${tested.key}`)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('error')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
