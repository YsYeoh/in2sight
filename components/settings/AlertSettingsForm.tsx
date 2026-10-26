'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { SaveBar } from '@/components/settings/SaveBar';
import { FormField } from '@/components/shared/FormField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ALERT_KINDS, LIMITS, type AlertSettings } from '@/lib/alerts/settings';

export interface AlertSettingsFormProps {
  initial: AlertSettings;
  save: (raw: unknown) => Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }>;
}

const NUMBERS = ['reachDropPct', 'takingOffRatio', 'syncFailures'] as const;
type Nums = Record<(typeof NUMBERS)[number], string>;

// numbers are kept and sent as typed text; the server parses them (empty = the default), clamps and returns what it stored
const numsOf = (s: AlertSettings): Nums => Object.fromEntries(NUMBERS.map((k) => [k, String(s[k])])) as Nums;

/** Explicit save (Plan 16a): dirty = differs from what the server last stored; the sticky SaveBar saves or discards. */
export function AlertSettingsForm({ initial, save }: AlertSettingsFormProps) {
  const t = useTranslations('settings.notifications');
  const tk = useTranslations('notifications.kinds');
  const [stored, setStored] = useState(initial);
  const [push, setPush] = useState(initial.push);
  const [nums, setNums] = useState(() => numsOf(initial));
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify({ push, nums }) !== JSON.stringify({ push: stored.push, nums: numsOf(stored) });

  const reset = (s: AlertSettings) => {
    setPush(s.push);
    setNums(numsOf(s));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await save({ push, ...nums });
      if (!r.ok) return setResult('error');
      setStored(r.settings);
      reset(r.settings); // the server's normalised values win
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
          <SaveBar dirty={dirty} pending={pending} result={result} error={t('saveError')} saved={t('saved')} onDiscard={() => reset(stored)} />
        </form>
      </CardContent>
    </Card>
  );
}
