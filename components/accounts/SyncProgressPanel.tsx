'use client';

// The onboarding / sync progress panel (docs/TODO.md §6a): one card per account that is importing or just finished.
// Server state from useSyncProgress, so it survives reloads. Stage checklist, the current activity, elapsed time and an
// honest estimate, plain-language rate-limit / stall / error states with Retry or Reconnect, a completion summary.
// One polite live region per card announces only stage and phase changes (never every percent tick).
import Link from 'next/link';
import { Circle, CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { StoredAccount } from '@/lib/accounts/types';
import { formatDay, formatNumber, formatPercent } from '@/lib/format';
import type { AccountProgress, StageView } from '@/lib/sync/progress';
import { cn } from '@/lib/utils';

const minutes = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));

function StageRow({ s }: { s: StageView }) {
  const t = useTranslations('sync');
  const { prefs } = usePrefs();
  const n = (v: number | null) => formatNumber(v ?? 0, prefs);
  const count = s.total && s.stage === 'account_days' ? t('days', { done: n(s.done), total: n(s.total) }) : s.total && s.stage === 'post_metrics' ? t('posts', { done: n(s.done), total: n(s.total) }) : null;
  const reason = s.state === 'skipped' && s.reason && t.has(`skip.${s.reason}`) ? t(`skip.${s.reason}`) : null;
  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      <span className="mt-0.5 shrink-0">
        {s.state === 'done' ? (
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
        ) : s.state === 'running' ? (
          <InsightOrb size="xs" decorative />
        ) : s.state === 'failed' ? (
          <CircleX aria-hidden="true" className="size-4 text-destructive" />
        ) : s.state === 'skipped' ? (
          <CircleMinus aria-hidden="true" className="size-4 text-muted-foreground" />
        ) : (
          <Circle aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block break-words', s.state === 'pending' && 'text-muted-foreground')}>{t(`stages.${s.stage}`)}</span>
        {reason ? <span className="block text-xs text-muted-foreground">{reason}</span> : null}
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {count ? <span className="block">{count}</span> : null}
        <span className="block">{t(`state.${s.state}`)}</span>
      </span>
    </li>
  );
}

function PanelCard({ p, account, busy, onRetry }: { p: AccountProgress; account: StoredAccount; busy: boolean; onRetry: (id: string) => void }) {
  const t = useTranslations('sync');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const username = account.username;
  const done = p.phase === 'done';
  const pct = formatPercent(p.percent / 100, prefs, 0);
  const activity = p.current
    ? t(`activity.${p.current.stage}`, { day: p.current.day ? formatDay(p.current.day, prefs) : '', done: formatNumber(p.current.done + 1, prefs), total: formatNumber(p.current.total ?? 0, prefs) })
    : null;
  const reason = p.errorKey && tErr.has(p.errorKey) ? tErr(p.errorKey) : tErr('unexpected');
  const status =
    p.phase === 'running' ? activity
    : p.phase === 'rate_limited' ? t('phase.rate_limited', { minutes: formatNumber(minutes(p.resumeInMs ?? 0), prefs) })
    : p.phase === 'failed' ? t('phase.failed', { reason })
    : t(`phase.${p.phase}`);
  const currentStage = p.stages.find((s) => s.state === 'running' || s.state === 'failed') ?? p.stages.find((s) => s.state === 'pending');
  const announce = done ? t('phase.done') : t('announce', { username, stage: currentStage ? t(`stages.${currentStage.stage}`) : t('phase.waiting') });

  return (
    <Card>
      <CardContent className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="min-w-0 break-words font-semibold">{done ? t('doneTitle', { username }) : t('panelTitle', { username })}</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{t('percent', { pct })}</span>
        </div>
        {/* the kit's Progress does not forward `value` to the progressbar element, so the numbers are set here */}
        <Progress value={p.percent} aria-label={t('progressLabel', { username })} aria-valuenow={p.percent} aria-valuetext={t('percent', { pct })} />
        {status ? (
          <p className={cn('flex min-w-0 items-center gap-2 text-sm', p.phase === 'failed' || p.phase === 'needs_reconnect' || p.phase === 'stalled' ? 'text-destructive' : 'text-muted-foreground')}>
            {p.phase === 'running' ? <InsightOrb size="xs" decorative /> : null}
            <span className="min-w-0 break-words">{status}</span>
          </p>
        ) : null}
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {p.stages.map((s) => (
            <StageRow key={s.stage} s={s} />
          ))}
        </ol>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 break-words">
            {done
              ? t('summary', { days: formatNumber(p.summary.days, prefs), posts: formatNumber(p.summary.posts, prefs) })
              : [p.elapsedMs !== null ? t('elapsed', { minutes: formatNumber(minutes(p.elapsedMs), prefs) }) : null, p.etaMs !== null ? t('eta', { minutes: formatNumber(minutes(p.etaMs), prefs) }) : t('estimating')].filter(Boolean).join(' · ')}
          </span>
          <span className="flex flex-wrap gap-2">
            {p.phase === 'failed' || p.phase === 'stalled' ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onRetry(p.accountId)}>
                {t('retry')}
              </Button>
            ) : null}
            {p.phase === 'needs_reconnect' ? (
              <Button size="sm" asChild>
                <a href={connectHref(account.groupName)} target="_top">{t('reconnect')}</a>
              </Button>
            ) : null}
            {done ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/accounts/${p.accountId}`}>{t('openDashboard')}</Link>
              </Button>
            ) : null}
          </span>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </CardContent>
    </Card>
  );
}

export function SyncProgressPanel({ progress, accounts, busy = false, onRetry }: { progress: AccountProgress[]; accounts: StoredAccount[]; busy?: boolean; onRetry: (id: string) => void }) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const shown = progress.filter((p) => byId.has(p.accountId));
  if (shown.length === 0) return null;
  return (
    <section className="mb-[var(--gp)] grid gap-[var(--gp)]">
      {shown.map((p) => (
        <PanelCard key={p.accountId} p={p} account={byId.get(p.accountId)!} busy={busy} onRetry={onRetry} />
      ))}
    </section>
  );
}
