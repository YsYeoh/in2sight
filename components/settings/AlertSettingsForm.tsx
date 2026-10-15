'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ALERT_KINDS, LIMITS, type AlertSettings } from '@/lib/alerts/settings';

export interface AlertSettingsFormProps {
  initial: AlertSettings;
  save: (raw: unknown) => Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }>;
}

const NUMBERS = ['reachDropPct', 'takingOffRatio', 'syncFailures'] as const;

export function AlertSettingsForm({ initial, save }: AlertSettingsFormProps) {
  const t = useTranslations('settings.notifications');
  const tk = useTranslations('notifications.kinds');
  const tc = useTranslations('common');
  const [push, setPush] = useState(initial.push);
  // numbers are kept as typed text; the server clamps and returns what it stored
  const [nums, setNums] = useState(() => Object.fromEntries(NUMBERS.map((k) => [k, String(initial[k])])) as Record<(typeof NUMBERS)[number], string>);
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await save({ push, ...Object.fromEntries(NUMBERS.map((k) => [k, Number(nums[k])])) });
      if (!r.ok) return setResult('error');
      setPush(r.settings.push);
      setNums(Object.fromEntries(NUMBERS.map((k) => [k, String(r.settings[k])])) as typeof nums);
      setResult('saved');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rulesTitle')}</CardTitle>
        <CardDescription>{t('rulesDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-[var(--gp)]">
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('pushFor')}</legend>
            {ALERT_KINDS.map((k) => (
              <FormField key={k} id={`push-${k}`} label={tk(`${k}.title`)} className="flex-row items-center justify-between gap-3">
                {(p) => <Switch {...p} checked={push[k]} onCheckedChange={(v) => setPush((s) => ({ ...s, [k]: v }))} />}
              </FormField>
            ))}
          </fieldset>
          <div className="grid gap-[var(--gp)] md:grid-cols-3">
            {NUMBERS.map((k) => (
              <FormField key={k} id={`alert-${k}`} label={t(k)} hint={t(`${k}Hint`)}>
                {(p) => <Input {...p} type="number" inputMode="decimal" min={LIMITS[k][0]} max={LIMITS[k][1]} step={LIMITS[k][2] ? 0.1 : 1} value={nums[k]} onChange={(e) => setNums((s) => ({ ...s, [k]: e.target.value }))} />}
              </FormField>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {tc('save')}
            </Button>
            {result === 'saved' ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('saved')}
              </p>
            ) : null}
            {result === 'error' ? (
              <p role="alert" className="text-sm text-destructive">
                {t('saveError')}
              </p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
