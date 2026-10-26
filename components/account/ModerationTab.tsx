'use client';

// The Moderation tab (Plan 15d): auto-hide (off by default; switching on shows the preview count first), the rules
// (four built-in spam patterns + banned words) with the live preview, and the moderation log with Undo and server
// pages. The server actions arrive as props; only TYPES come from the server modules (tests/moderation-privacy.test.ts).
import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isDefiniteFailure, useModerationRun } from '@/components/account/CommentActions';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Pagination } from '@/components/shared/Pagination';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime, formatNumber } from '@/lib/format';
import { MAX_WORD_RULES, SPAM_KINDS, type ModerationRule, type SpamKind } from '@/lib/moderation/rules';
import type { ModerationResult, PreviewResult, RuleResult } from '@/lib/moderation/service';
import type { LogEntry, ModerationData } from '@/lib/moderation/store';

export interface ModerationActions {
  saveWord: (accountId: string, pattern: string, wholeWord: boolean) => Promise<RuleResult>;
  previewWord: (accountId: string, pattern: string, wholeWord: boolean) => Promise<PreviewResult>;
  setSpam: (accountId: string, kind: SpamKind, on: boolean) => Promise<RuleResult>;
  deleteRule: (accountId: string, ruleId: string) => Promise<RuleResult>;
  setAutoHide: (accountId: string, enabled: boolean) => Promise<RuleResult>;
  undo: (accountId: string, logId: number, requestId: string) => Promise<ModerationResult>;
}

export interface ModerationTabProps {
  accountId: string;
  allowed: boolean;
  data: ModerationData | null;
  scope?: Record<string, string>;
  actions: ModerationActions;
}

function useRuleName() {
  const t = useTranslations('pages.account.moderation');
  return (rule: ModerationRule | undefined) => (!rule ? t('ruleLabel.removed') : rule.kind === 'word' ? t('ruleLabel.word', { word: rule.pattern ?? '' }) : t(`ruleLabel.${rule.kind}`));
}

function AutoHideCard({ accountId, data, setAutoHide }: { accountId: string; data: ModerationData; setAutoHide: ModerationActions['setAutoHide'] }) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const ruleName = useRuleName();
  const { busy, error, run } = useModerationRun();
  const [confirm, setConfirm] = useState(false);
  const { settings: s, preview: p } = data;
  const paused = s.pausedAt !== null;
  const on = s.autoHide && !paused;
  const noRules = data.rules.length === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('auto.title')}</CardTitle>
        <CardDescription>{t('auto.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {paused ? (
          <Alert>
            <AlertDescription>
              {t(s.pauseReason === 'reconnect' ? 'auto.pausedReconnect' : 'auto.pausedFailing')} {t('auto.pausedSince', { date: formatDateTime(s.pausedAt!, prefs) })}
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="mod-auto">{t('auto.switch')}</Label>
          <Switch
            id="mod-auto"
            checked={on}
            disabled={busy || (noRules && !on)}
            aria-describedby={noRules ? 'mod-auto-hint' : undefined}
            onCheckedChange={(v) => (v ? setConfirm(true) : void run(() => setAutoHide(accountId, false)))}
          />
        </div>
        {noRules ? (
          <p id="mod-auto-hint" className="text-sm text-muted-foreground">
            {t('auto.noRules')}
          </p>
        ) : null}
        {error && !confirm ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <section aria-labelledby="mod-preview" className="flex flex-col gap-2">
          <h3 id="mod-preview" className="text-sm font-medium">
            {t('preview.title')}
          </h3>
          <p aria-live="polite" className="text-sm">
            {t('preview.count', { count: p.count, n: formatNumber(p.count, prefs) })}
          </p>
          <p className="text-xs text-muted-foreground">{t('preview.basis', { count: formatNumber(p.scanned, prefs) })}</p>
          {p.sample.length ? (
            <ul className="flex flex-col gap-2">
              {p.sample.map((x) => (
                <li key={x.id} className="rounded-md border p-2 text-sm">
                  <span className="font-medium">@{x.authorUsername ?? '—'}</span> <span className="break-words">{x.snippet}</span>
                  <span className="block text-xs text-muted-foreground">{t('preview.by', { rule: ruleName(x.rule) })}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        title={t('auto.enableTitle')}
        body={t('auto.enableBody', { count: p.count, n: formatNumber(p.count, prefs) })}
        confirmLabel={t('auto.enableConfirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={confirm ? error : null}
        onConfirm={() => void run(() => setAutoHide(accountId, true), () => setConfirm(false))}
        onClose={() => setConfirm(false)}
      />
    </Card>
  );
}

function RulesCard({ accountId, rules, autoOn, actions }: { accountId: string; rules: ModerationRule[]; autoOn: boolean; actions: ModerationActions }) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const { busy, error, run } = useModerationRun();
  const [word, setWord] = useState('');
  const [whole, setWhole] = useState(true); // whole word is the default: "ass" must not hide "class"
  const [confirmCount, setConfirmCount] = useState<number | null>(null); // auto-hide on: how many existing comments the new word would hide
  const words = rules.filter((r) => r.kind === 'word');
  const save = () =>
    run(() => actions.saveWord(accountId, word, whole), () => {
      setConfirmCount(null);
      setWord('');
      setWhole(true);
    });
  const submit = async () => {
    if (!autoOn) return save();
    let count = 0;
    await run(
      async () => {
        const r: PreviewResult = await actions.previewWord(accountId, word, whole);
        if (r.ok) count = r.count;
        return r;
      },
      () => setConfirmCount(count),
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rules.title')}</CardTitle>
        <CardDescription>{t('rules.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-[var(--gp)]">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">{t('rules.spamTitle')}</legend>
          {SPAM_KINDS.map((k) => (
            <div key={k} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor={`mod-spam-${k}`}>{t(`rules.${k}.label`)}</Label>
                <p id={`mod-spam-${k}-hint`} className="text-xs text-muted-foreground">
                  {t(`rules.${k}.hint`)}
                </p>
              </div>
              <Switch id={`mod-spam-${k}`} checked={rules.some((r) => r.kind === k)} disabled={busy} aria-describedby={`mod-spam-${k}-hint`} onCheckedChange={(v) => void run(() => actions.setSpam(accountId, k, v))} />
            </div>
          ))}
        </fieldset>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h3 className="text-sm font-medium">{t('rules.wordsTitle')}</h3>
          <FormField id="mod-word" label={t('rules.wordLabel')} hint={t('rules.wordHint')}>
            {(p) => <Input {...p} value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />}
          </FormField>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-[var(--ctl)] items-center gap-2">
              <Checkbox id="mod-whole" checked={whole} onCheckedChange={(v) => setWhole(v === true)} />
              <Label htmlFor="mod-whole">{t('rules.wholeWord')}</Label>
            </div>
            <LoadingButton type="submit" pending={busy} disabled={word.trim() === ''}>
              {t('rules.add')}
            </LoadingButton>
          </div>
        </form>
        {error && confirmCount === null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t('rules.count', { count: formatNumber(words.length, prefs), max: formatNumber(MAX_WORD_RULES, prefs) })}</p>
        {words.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('rules.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {words.map((w) => (
              <li key={w.id} className="flex max-w-full items-center gap-1 rounded-md border py-1 pl-2 text-sm">
                <span className="break-all">{t('ruleLabel.word', { word: w.pattern ?? '' })}</span>
                {w.wholeWord ? <Badge variant="secondary">{t('rules.wholeBadge')}</Badge> : null}
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('rules.remove', { word: w.pattern ?? '' })} disabled={busy} onClick={() => void run(() => actions.deleteRule(accountId, w.id))}>
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirmCount !== null}
        title={t('rules.confirmTitle')}
        body={t('rules.confirmBody', { count: confirmCount ?? 0, n: formatNumber(confirmCount ?? 0, prefs) })}
        confirmLabel={t('rules.confirmAdd')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={confirmCount !== null ? error : null}
        onConfirm={() => void save()}
        onClose={() => setConfirmCount(null)}
      />
    </Card>
  );
}

function LogCard({ accountId, data, scope, undo }: { accountId: string; data: ModerationData; scope?: Record<string, string>; undo: ModerationActions['undo'] }) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const ruleName = useRuleName();
  const { busy, error, run, clearError } = useModerationRun();
  const [target, setTarget] = useState<LogEntry | null>(null);
  const [requestId, setRequestId] = useState('');
  const { rows, total, page, pages, size } = data.log;
  const hrefFor = (p: number) => `?${new URLSearchParams({ tab: 'moderation', ...(scope ?? {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
  const actor = (a: string) => (a === 'owner' ? t('log.byOwner') : t('log.byRule', { rule: ruleName(data.rules.find((r) => `rule:${r.id}` === a)) }));
  const result = (shown: string) =>
    shown === 'ok' || shown === 'pending' || shown === 'unknown' ? t(`log.results.${shown}`) : t.has(`errors.${shown}`) ? t(`errors.${shown}`) : t('errors.unexpected');
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>{t('log.title')}</CardTitle>
        <CardDescription>{t('log.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('log.empty')}</p>
        ) : (
          <ol className="flex flex-col divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="font-medium">{t(`log.actions.${r.action}`)}</span>
                  <time dateTime={r.createdAt} className="text-xs text-muted-foreground">
                    {formatDateTime(r.createdAt, prefs)}
                  </time>
                </div>
                <p className="text-sm">
                  {actor(r.actor)} · {result(r.shown)}
                </p>
                <p className="break-words text-sm text-muted-foreground">{r.context ? `@${r.context.authorUsername ?? '—'}: ${r.context.snippet ?? ''}` : t('log.gone')}</p>
                {r.undoneAt ? (
                  <p className="text-xs text-muted-foreground">{t('log.undone', { date: formatDateTime(r.undoneAt, prefs) })}</p>
                ) : r.undo ? (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        clearError();
                        setRequestId(crypto.randomUUID());
                        setTarget(r);
                      }}
                    >
                      {t(`log.undo.${r.undo}`)}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {total > 0 ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {t('log.range', { first: formatNumber(first, prefs), last: formatNumber(Math.min(page * size, total), prefs), total: formatNumber(total, prefs) })}
          </p>
        ) : null}
        <Pagination page={page} pages={pages} hrefFor={hrefFor} />
      </CardContent>
      <ConfirmDialog
        open={target !== null && target.undo !== null}
        title={target?.undo ? t(`log.undoTitle.${target.undo}`) : ''}
        body={target?.undo ? t(`log.undoBody.${target.undo}`) : ''}
        confirmLabel={target?.undo ? t(`log.undo.${target.undo}`) : ''}
        cancelLabel={t('cancel')}
        busy={busy}
        error={error}
        onConfirm={() => target && void run(() => undo(accountId, target.id, requestId), () => setTarget(null), (e) => isDefiniteFailure(e) && setRequestId(crypto.randomUUID()))}
        onClose={() => setTarget(null)}
      />
    </Card>
  );
}

export function ModerationTab({ accountId, allowed, data, scope, actions }: ModerationTabProps) {
  const t = useTranslations('pages.account.moderation');
  if (!allowed)
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden="true" />}
        title={t('noScope.title')}
        description={t('noScope.body')}
        action={
          <Button asChild variant="outline">
            <Link href="/accounts">{t('noScope.link')}</Link>
          </Button>
        }
      />
    );
  if (!data) return <EmptyState icon={<ShieldAlert aria-hidden="true" />} title={t('notReady.title')} description={t('notReady.body')} />;
  return (
    <div className="flex flex-col gap-[var(--gp)]">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      <div className="grid gap-[var(--gp)] lg:grid-cols-2">
        <AutoHideCard accountId={accountId} data={data} setAutoHide={actions.setAutoHide} />
        <RulesCard accountId={accountId} rules={data.rules} autoOn={data.settings.autoHide && data.settings.pausedAt === null} actions={actions} />
        <LogCard accountId={accountId} data={data} scope={scope} undo={actions.undo} />
      </div>
    </div>
  );
}
