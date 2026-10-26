'use client';

import { useState } from 'react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';
import type { PushDevice } from '@/lib/push/devices';

export interface DeviceListProps {
  /** null = the list could not be read */
  devices: PushDevice[] | null;
  remove: (id: number) => Promise<{ ok: boolean; error?: string }>;
}

/** Every device that gets push (Plan 16a). Remove asks first; the list refreshes from the server afterwards. */
export function DeviceList({ devices, remove }: DeviceListProps) {
  const t = useTranslations('settings.notifications');
  const tc = useTranslations('common');
  const { prefs } = usePrefs();
  const router = useRouter();
  const [pick, setPick] = useState<PushDevice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (d: PushDevice) => d.label ?? t('devicesUnknown');

  const confirm = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const r = await remove(pick.id);
      if (!r.ok) return setError(t('devicesError'));
      setPick(null);
      router.refresh();
    } catch (e) {
      if (isRedirectError(e)) throw e;
      setError(t('devicesError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('devicesTitle')}</CardTitle>
        <CardDescription>{t('devicesDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {devices === null ? (
          <p role="alert" className="text-sm text-destructive">
            {t('devicesLoadError')}
          </p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('devicesEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{name(d)}</p>
                  <p className="text-xs text-muted-foreground">{t('devicesAdded', { date: formatDate(d.createdAt, prefs) })}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => (setError(null), setPick(d))}>
                  {t('devicesRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{t('devicesHint')}</p>
      </CardContent>
      {pick ? (
        <ConfirmDialog
          open
          title={t('devicesRemoveTitle', { device: name(pick) })}
          body={t('devicesRemoveBody')}
          confirmLabel={t('devicesRemove')}
          cancelLabel={tc('cancel')}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onClose={() => setPick(null)}
        />
      ) : null}
    </Card>
  );
}
