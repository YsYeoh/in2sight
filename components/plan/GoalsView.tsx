'use client';

// The Goals section (Plan 17d): one explicit-save form per account (UI standard 18: dirty tracking against the stored
// goals, SaveBar, unsaved-changes guard). An empty field = no goal. The browser checks the same rules as the server
// (parseGoalInput) so a wrong value is named before saving; the server checks again.
import { useState, useTransition } from 'react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useRouter } from 'next/navigation';
import { CircleUserRound, DatabaseZap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { GoalLine } from '@/components/plan/GoalLine';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { SaveBar } from '@/components/settings/SaveBar';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TARGET_MAX, type Goal } from '@/lib/analysis/goals';
import { formatNumber } from '@/lib/format';
import { parseGoalInput, type GoalError } from '@/lib/plan/goals';
import type { GoalsAccount } from '@/lib/plan/model';
import { addDays } from '@/lib/sync/time';

type Values = { followers: string; followersDue: string; avg_reach: string; posts_per_week: string };
export type SaveGoals = (accountId: string, raw: Values) => Promise<{ ok: true } | { ok: false; error: GoalError }>;

const valuesOf = (goals: Goal[]): Values => {
  const of = (m: Goal['metric']) => goals.find((g) => g.metric === m);
  return { followers: of('followers') ? String(of('followers')!.target) : '', followersDue: of('followers')?.dueDay ?? '', avg_reach: of('avg_reach') ? String(of('avg_reach')!.target) : '', posts_per_week: of('posts_per_week') ? String(of('posts_per_week')!.target) : '' };
};

function AccountGoals({ a, today, save }: { a: GoalsAccount; today: string; save: SaveGoals }) {
  const t = useTranslations('plan.goals');
  const { prefs } = usePrefs();
  const router = useRouter();
  const [stored, setStored] = useState(() => valuesOf(a.goals));
  const [v, setV] = useState(stored);
  const [result, setResult] = useState<'saved' | 'error' | null>(null);
  const [error, setError] = useState<GoalError>('unexpected');
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(stored);
  // A followers goal whose day has passed stays as it is (it says "Missed"); it must not block the other goals. Setting or changing the followers goal needs a day after today.
  const followersTouched = v.followers !== stored.followers || v.followersDue !== stored.followersDue;
  const valid = parseGoalInput(v, today) !== null && (!followersTouched || v.followers === '' || v.followersDue > today);
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const max = (m: Goal['metric']) => formatNumber(TARGET_MAX[m], prefs);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) {
      setError('invalid');
      return setResult('error');
    }
    start(async () => {
      try {
        const r = await save(a.id, v);
        if (!r.ok) {
          setError(r.error);
          return setResult('error');
        }
        setStored(v);
        setResult('saved');
        router.refresh(); // the progress lines are computed on the server
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError('unexpected');
        setResult('error');
      }
    });
  };

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>@{a.username}</CardTitle>
        <CardDescription>{t('formHint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-[var(--gp)]">
        {a.progress.length ? (
          <ul className="grid gap-2" aria-label={t('progressLabel', { username: a.username })}>
            {a.progress.map((p) => (
              <GoalLine key={p.metric} p={p} />
            ))}
          </ul>
        ) : null}
        <form onSubmit={submit} noValidate className="flex flex-col gap-[var(--gp)]">
          <div className="grid gap-[var(--gp)] md:grid-cols-2">
            <FormField id={`${a.id}-followers`} label={t('followers')} hint={t('followersHint', { max: max('followers') })}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={TARGET_MAX.followers} step={1} value={v.followers} onChange={set('followers')} />}
            </FormField>
            <FormField id={`${a.id}-due`} label={t('followersDue')} hint={t('followersDueHint')}>
              {(p) => <Input {...p} type="date" min={addDays(today, 1)} value={v.followersDue} onChange={set('followersDue')} disabled={v.followers === ''} />}
            </FormField>
            <FormField id={`${a.id}-avg`} label={t('avgReach')} hint={t('avgReachHint', { max: max('avg_reach') })}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={TARGET_MAX.avg_reach} step={1} value={v.avg_reach} onChange={set('avg_reach')} />}
            </FormField>
            <FormField id={`${a.id}-ppw`} label={t('postsPerWeek')} hint={t('postsPerWeekHint', { max: max('posts_per_week') })}>
              {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={TARGET_MAX.posts_per_week} step={1} value={v.posts_per_week} onChange={set('posts_per_week')} />}
            </FormField>
          </div>
          <SaveBar dirty={dirty} pending={pending} result={result} error={t(`errors.${error}`)} saved={t('saved')} onDiscard={() => (setV(stored), setResult(null))} />
        </form>
      </CardContent>
    </Card>
  );
}

export function GoalsView({ accounts, ready, today, save }: { accounts: GoalsAccount[]; ready: boolean; today: string; save: SaveGoals }) {
  const t = useTranslations('plan.goals');
  if (!ready) return <EmptyState icon={<DatabaseZap className="size-5" aria-hidden />} title={t('needsUpdate')} description={t('needsUpdateHint')} />;
  if (accounts.length === 0) return <EmptyState icon={<CircleUserRound className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />;
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="text-xs text-muted-foreground">{t('pattern')}</p>
      {accounts.map((a) => (
        <AccountGoals key={a.id} a={a} today={today} save={save} />
      ))}
    </div>
  );
}
