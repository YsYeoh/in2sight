'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { Segmented } from '@/components/shared/Segmented';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Tag } from '@/lib/analysis/types';
import { RULE_FORMATS, RULE_KINDS, type RuleKind, type TagRule } from '@/lib/tag-rules/rules';
import type { ApplyRulesResult, RuleResult } from '@/app/(app)/tags/actions';

export interface RuleActions {
  add: (tagId: string, kind: string, value: string) => Promise<RuleResult>;
  remove: (ruleId: string) => Promise<RuleResult>;
  preview: (tagId: string) => Promise<ApplyRulesResult>;
  apply: (tagId: string) => Promise<ApplyRulesResult>;
}

type Format = (typeof RULE_FORMATS)[number];

/** One tag's rules: list with Remove, an add form, and "Apply to existing posts" with a preview count before it writes. */
function RulesBody({ tag, rules, actions }: { tag: Tag; rules: TagRule[]; actions: RuleActions }) {
  const t = useTranslations('pages.tags.rules');
  const tTags = useTranslations('pages.tags');
  const tErr = useTranslations('pages.tags.errors');
  const tf = useTranslations('analysis.format');
  const [kind, setKind] = useState<RuleKind>('hashtag');
  const [value, setValue] = useState('');
  const [format, setFormat] = useState<Format>('REELS');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null); // posts the apply would tag; null = not checked
  const [applied, setApplied] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'add' | 'check' | 'apply' | null>(null);

  const label = (r: TagRule) => (r.kind === 'format' ? t('label.format', { format: tf(r.value) }) : t(`label.${r.kind}`, { value: r.value }));
  const run = (what: 'add' | 'check' | 'apply' | null, fn: () => Promise<void>) => {
    setBusy(what);
    start(async () => {
      await fn();
      setBusy(null);
    });
  };
  const reset = () => {
    setPreview(null);
    setApplied(null);
  };

  return (
    <div className="grid min-w-0 gap-4">
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t('title', { name: tag.name })}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t('hint')}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="grid gap-1">
          {rules.map((r) => (
            <li key={r.id} className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 break-words text-sm" dir="auto">
                {label(r)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                aria-label={t('removeNamed', { rule: label(r) })}
                onClick={() =>
                  run(null, async () => {
                    const res = await actions.remove(r.id);
                    reset();
                    setError(res.ok ? null : tErr(res.error));
                  })
                }
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid min-w-0 gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run('add', async () => {
            const res = await actions.add(tag.id, kind, kind === 'format' ? format : value);
            reset();
            if (res.ok) {
              setValue('');
              setError(null);
            } else setError(tErr(res.error));
          });
        }}
      >
        <Segmented
          label={t('kind')}
          value={kind}
          options={RULE_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
          onChange={(k) => {
            setKind(k);
            setError(null);
          }}
        />
        {kind === 'format' ? (
          <Segmented label={t('format')} value={format} options={RULE_FORMATS.map((f) => ({ value: f, label: tf(f) }))} onChange={setFormat} />
        ) : (
          <FormField id={`rule-value-${tag.id}`} label={t(`valueLabel.${kind}`)}>
            {(p) => <Input {...p} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" dir="auto" />}
          </FormField>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div>
          <LoadingButton type="submit" pending={busy === 'add'} disabled={pending || (kind !== 'format' && value.trim() === '')}>
            {t('add')}
          </LoadingButton>
        </div>
      </form>
      <div className="grid gap-2 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground">{t('applyHint')}</p>
        {preview === null ? (
          <div>
            <LoadingButton
              type="button"
              variant="outline"
              pending={busy === 'check'}
              disabled={pending || rules.length === 0}
              onClick={() =>
                run('check', async () => {
                  const res = await actions.preview(tag.id);
                  setApplied(null);
                  if (res.ok) {
                    setPreview(res.posts);
                    setError(null);
                  } else setError(tErr(res.error));
                })
              }
            >
              {t('applyExisting')}
            </LoadingButton>
          </div>
        ) : (
          <>
            <p role="status" className="text-sm">
              {preview === 0 ? t('previewNone') : t('preview', { count: preview })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setPreview(null)}>
                {tTags('cancel')}
              </Button>
              {preview > 0 ? (
                <LoadingButton
                  type="button"
                  pending={busy === 'apply'}
                  disabled={pending}
                  onClick={() =>
                    run('apply', async () => {
                      const res = await actions.apply(tag.id);
                      setPreview(null);
                      if (res.ok) setApplied(res.posts);
                      else setError(tErr(res.error));
                    })
                  }
                >
                  {t('apply')}
                </LoadingButton>
              ) : null}
            </div>
          </>
        )}
        {applied !== null ? (
          <p role="status" className="text-sm">
            {t('applied', { count: applied })}
          </p>
        ) : null}
      </div>
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline">
            {t('close')}
          </Button>
        </ResponsiveDialogClose>
      </ResponsiveDialogFooter>
    </div>
  );
}

/** The Rules dialog of one tag (null = closed). `rules` are that tag's rules, oldest first. */
export function TagRulesDialog({ tag, rules, actions, onClose }: { tag: Tag | null; rules: TagRule[]; actions: RuleActions; onClose: () => void }) {
  return (
    <ResponsiveDialog open={tag !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>{tag ? <RulesBody key={tag.id} tag={tag} rules={rules} actions={actions} /> : null}</ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
