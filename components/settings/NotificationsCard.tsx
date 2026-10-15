'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { vapidKeyBytes } from '@/lib/push/subscription';
import { isIos, isStandalone } from '@/lib/pwa';

type Result = { ok: boolean };
type Status = 'checking' | 'unsupported' | 'ios-install' | 'not-configured' | 'denied' | 'off' | 'on';

export interface NotificationsCardProps {
  vapidPublicKey: string | null;
  save: (subscription: unknown, userAgent: string) => Promise<Result>;
  remove: (endpoint: string) => Promise<Result>;
}

export function NotificationsCard({ vapidPublicKey, save, remove }: NotificationsCardProps) {
  const t = useTranslations('settings.notifications');
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    const set = (s: Status) => alive && setStatus(s);
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return set(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      if (!vapidPublicKey) return set('not-configured');
      if (Notification.permission === 'denied') return set('denied');
      const reg = await navigator.serviceWorker.getRegistration();
      set((await reg?.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => set('off'));
    return () => {
      alive = false;
    };
  }, [vapidPublicKey]);

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

  const disable = () =>
    start(async () => {
      setError(false);
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

  const note = (key: 'checking' | 'unsupported' | 'iosInstall' | 'notConfigured' | 'denied') => <p className="text-sm text-muted-foreground">{t(key)}</p>;

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
        {status === 'unsupported' ? note('unsupported') : null}
        {status === 'ios-install' ? note('iosInstall') : null}
        {status === 'not-configured' ? note('notConfigured') : null}
        {status === 'denied' ? note('denied') : null}
        {status === 'off' ? (
          <div className="flex flex-col items-start gap-1.5">
            <Button onClick={enable} disabled={pending}>
              {t('enable')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('enableHint')}</p>
          </div>
        ) : null}
        {status === 'on' ? (
          <Button variant="outline" className="self-start" onClick={disable} disabled={pending}>
            {t('disable')}
          </Button>
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
