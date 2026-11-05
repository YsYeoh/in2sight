'use client';

import { useState, useTransition } from 'react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useTranslations } from 'next-intl';
import { SaveBar } from '@/components/settings/SaveBar';
import { FormField } from '@/components/shared/FormField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ALERT_KINDS, LIMITS, UNFOLLOW_SPIKE_ENABLED, type AlertSettings } from '@/lib/alerts/settings';
import { formatHour } from '@/lib/format';
import { DEFAULT_PREFS } from '@/lib/prefs';

export interface AlertSettingsFormProps {
  initial: AlertSettings;
  save: (raw: unknown) => Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: string }>;
  /** 24 labels, hour 0-23 in the owner's time format (formatHour with the request prefs, from the server section). */
  hourLabels?: string[];
}

const DEFAULT_HOURS = Array.from({ length: 24 }, (_, h) => formatHour(h, DEFAULT_PREFS));
// the unfollow-spike rule is off until its data is verified (lib/alerts/settings.ts): no switch for an alert that never fires
const PUSH_KINDS = ALERT_KINDS.filter((k) => k !== 'unfollow_spike' || UNFOLLOW_SPIKE_ENABLED);
const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';

const NUMBERS = ['reachDropPct', 'takingOffRatio', 'syncFailures'] as const;
type Nums = Record<(typeof NUMBERS)[number], string>;

// numbers are kept and sent as typed text; the server parses them (empty = the default), clamps and returns what it stored
const numsOf = (s: AlertSettings): Nums => Object.fromEntries(NUMBERS.map((k) => [k, String(s[k])])) as Nums;

/** Explicit save (Plan 16a): dirty = differs from what the server last stored; the sticky SaveBar saves or discards. */
export function AlertSettingsForm({ initial, save, hourLabels = DEFAULT_HOURS }: AlertSettingsFormProps) {
  const t = useTranslations('settings.notifications');
  const tk = useTranslations('notifications.kinds');
  const [stored, setStored] = useState(initial);
  const [push, setPush] = useState(initial.push);
  const [nums, setNums] = useState(() => numsOf(initial));
  const [quiet, setQuiet] = useState({ quietFrom: initial.quietFrom, quietTo: initial.quietTo });
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify({ push, nums, quiet }) !== JSON.stringify({ push: stored.push, nums: numsOf(stored), quiet: { quietFrom: stored.quietFrom, quietTo: stored.quietTo } });

  const reset = (s: AlertSettings) => {
    setPush(s.push);
    setNums(numsOf(s));
    setQuiet({ quietFrom: s.quietFrom, quietTo: s.quietTo });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      try {
        const r = await save({ push, ...nums, ...quiet });
        if (!r.ok) return setResult('error');
        setStored(r.settings);
        reset(r.settings); // the server's normalised values win
        setResult('saved');
      } catch (e) {
        if (isRedirectError(e)) throw e; // an expired session: Next follows it
        setResult('error'); // a network drop: the typed values stay, Save again
      }
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
            {PUSH_KINDS.map((k) => (
              <FormField key={k} id={`push-${k}`} label={tk(`${k}.title`)} className="flex-row items-center justify-between gap-3">
                {(p) => <Switch {...p} checked={push[k]} onCheckedChange={(v) => setPush((s) => ({ ...s, [k]: v }))} />}
              </FormField>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('quietTitle')}</legend>
            <div className="grid gap-[var(--gp)] sm:grid-cols-2">
              {(['quietFrom', 'quietTo'] as const).map((k) => (
                <FormField key={k} id={`alert-${k}`} label={t(k)}>
                  {(p) => (
                    <select {...p} className={SELECT} value={quiet[k]} onChange={(e) => setQuiet((s) => ({ ...s, [k]: Number(e.target.value) }))}>
                      {hourLabels.map((label, h) => (
                        <option key={h} value={h}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('quietHint', { time: hourLabels[quiet.quietTo] ?? '' })}</p>
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
