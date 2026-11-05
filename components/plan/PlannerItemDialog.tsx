'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { MediaThumb, type ThumbMedia } from '@/components/shared/MediaThumb';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Tag } from '@/lib/analysis/types';
import { formatDateTime, formatDay, formatHour, formatPercent } from '@/lib/format';
import {
  linkCandidates,
  MAX_ITEM_TAGS,
  NOTES_MAX,
  PLANNER_FORMATS,
  PLANNER_STATUSES,
  TITLE_MAX,
  type LinkMedia,
  type PlannerInput,
  type PlannerItem,
  type PlannerResult,
  type PlannerStatus,
  type SlotResult,
} from '@/lib/planner/items';
import { postLabHref } from '@/lib/post-lab/params';

export interface PlannerActions {
  save: (id: string | null, input: PlannerInput) => Promise<PlannerResult>;
  move: (id: string, status: PlannerStatus) => Promise<PlannerResult>;
  remove: (id: string) => Promise<PlannerResult>;
  suggest: (accountId: string) => Promise<SlotResult>;
}
/** A recent post the owner may link: its time, plus what the thumbnail needs (an 80-character caption snippet). */
export type PlannerMedia = LinkMedia & ThumbMedia;

const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface FormProps extends Pick<PlannerActions, 'save' | 'remove' | 'suggest'> {
  item: PlannerItem | null;
  accountId: string;
  accounts: { id: string; username: string }[];
  tags: Tag[];
  media: PlannerMedia[];
  linked: ReadonlyMap<string, string>;
  onDone: (text: string) => void;
}

function ItemForm({ item, accountId, accounts, tags, media, linked, save, remove, suggest, onDone }: FormProps) {
  const t = useTranslations('planner');
  const tErr = useTranslations('planner.errors');
  const tf = useTranslations('analysis.format');
  const tr = useTranslations('analysis.reasons');
  const { prefs } = usePrefs();
  const [v, setV] = useState<PlannerInput>(() =>
    item
      ? { accountId: item.accountId, title: item.title, notes: item.notes, status: item.status, format: item.format, plannedDay: item.plannedDay, plannedHour: item.plannedHour, tagIds: item.tagIds, mediaId: item.mediaId }
      : { accountId, title: '', notes: '', status: 'idea', format: null, plannedDay: null, plannedHour: null, tagIds: [], mediaId: null },
  );
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const set = (patch: Partial<PlannerInput>) => setV((p) => ({ ...p, ...patch }));
  const known = new Set(tags.map((tg) => tg.id));
  const picked = v.tagIds.filter((id) => known.has(id)); // a deleted tag's id is dropped on the next save
  const candidates = linkCandidates({ id: item?.id ?? '', accountId: v.accountId, format: v.format, plannedDay: v.plannedDay, plannedHour: v.plannedHour }, media, linked, prefs.timezone);
  const run = (fn: () => Promise<PlannerResult>, text: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) onDone(text);
      else setError(tErr(r.error));
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => save(item?.id ?? null, { ...v, tagIds: picked }), t('dialog.saved'));
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{item ? t('dialog.editTitle') : t('dialog.newTitle')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{t('dialog.description')}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>

      {accounts.length > 1 ? (
        <FormField id="plan-item-account" label={t('account')}>
          {(p) => (
            <select {...p} className={SELECT} value={v.accountId} onChange={(e) => set({ accountId: e.target.value, mediaId: null })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : null}
      <FormField id="plan-item-title" label={t('dialog.titleLabel')} required>
        {(p) => <Input {...p} value={v.title} maxLength={TITLE_MAX} autoComplete="off" onChange={(e) => set({ title: e.target.value })} />}
      </FormField>
      <FormField id="plan-item-notes" label={t('dialog.notes')} hint={t('dialog.notesHint')}>
        {(p) => <Textarea {...p} value={v.notes} maxLength={NOTES_MAX} rows={4} onChange={(e) => set({ notes: e.target.value })} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="plan-item-status" label={t('dialog.column')}>
          {(p) => (
            <select {...p} className={SELECT} value={v.status} onChange={(e) => set({ status: e.target.value as PlannerStatus, ...(e.target.value === 'posted' ? {} : { mediaId: null }) })}>
              {PLANNER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="plan-item-format" label={t('dialog.format')}>
          {(p) => (
            <select {...p} className={SELECT} value={v.format ?? ''} onChange={(e) => set({ format: (e.target.value || null) as PlannerInput['format'] })}>
              <option value="">{t('dialog.noFormat')}</option>
              {PLANNER_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {tf(f)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField id="plan-item-day" label={t('dialog.day')}>
          {(p) => <Input {...p} type="date" value={v.plannedDay ?? ''} onChange={(e) => set(e.target.value ? { plannedDay: e.target.value } : { plannedDay: null, plannedHour: null })} />}
        </FormField>
        <FormField id="plan-item-hour" label={t('dialog.hour')}>
          {(p) => (
            <select {...p} className={SELECT} disabled={v.plannedDay === null} value={v.plannedHour ?? ''} onChange={(e) => set({ plannedHour: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">{t('anyTime')}</option>
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {formatHour(h, prefs)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </div>

      <div className="grid gap-2">
        <Button type="button" variant="outline" className="justify-self-start" disabled={pending} onClick={() => start(async () => setSlots(await suggest(v.accountId)))}>
          {t('dialog.suggest')}
        </Button>
        {slots && !slots.ok ? (
          <p role="alert" className="text-sm text-destructive">
            {tErr(slots.error)}
          </p>
        ) : null}
        {slots && slots.ok ? (
          <div role="status" className="grid gap-2 text-xs text-muted-foreground">
            <p>{slots.reason ? t('dialog.suggestReason', { reason: tr(slots.reason), count: slots.sample }) : t('dialog.suggestBasis', { count: slots.sample })}</p>
            {!slots.reason && slots.slots.length === 0 ? <p>{t('dialog.suggestNone')}</p> : null}
            {slots.slots.length ? (
              <ul className="flex flex-wrap gap-2">
                {slots.slots.map((s) => (
                  <li key={s.day}>
                    <Button type="button" variant="outline" size="sm" onClick={() => set({ plannedDay: s.day, plannedHour: s.hour })}>
                      {t('dialog.slot', { day: formatDay(s.day, prefs), hour: formatHour(s.hour, prefs) })}
                    </Button>
                    <span className="ms-1">{t('dialog.slotBasis', { rate: formatPercent(s.value, prefs), count: s.count })}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('dialog.tags')}</legend>
        {tags.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('dialog.noTags')}{' '}
            <Link href="/tags" className="font-medium text-primary underline-offset-4 hover:underline">
              {t('dialog.manageTags')}
            </Link>
          </p>
        ) : (
          <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {tags.map((tag) => {
              const on = picked.includes(tag.id);
              return (
                <label key={tag.id} className="flex min-w-0 items-center gap-1.5">
                  <Checkbox checked={on} disabled={!on && picked.length >= MAX_ITEM_TAGS} onCheckedChange={(c) => set({ tagIds: c === true ? [...picked, tag.id] : picked.filter((x) => x !== tag.id) })} />
                  <TagBadge tag={tag} />
                </label>
              );
            })}
          </div>
        )}
      </fieldset>

      {v.status === 'ready' || v.status === 'posted' ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('dialog.link')}</legend>
          <p className="text-xs text-muted-foreground">{t('dialog.linkHint')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="plan-item-link" checked={v.mediaId === null} onChange={() => set({ mediaId: null })} />
            {t('dialog.noLink')}
          </label>
          {candidates.length === 0 ? <p className="text-xs text-muted-foreground">{t('dialog.noCandidates')}</p> : null}
          {candidates.map((c) => (
            <label key={c.media.id} className="flex min-w-0 items-center gap-2 text-sm">
              <input type="radio" name="plan-item-link" checked={v.mediaId === c.media.id} onChange={() => set({ mediaId: c.media.id, status: 'posted' })} />
              <MediaThumb media={c.media} badges={false} className="w-10 shrink-0 rounded-sm" />
              <span className="min-w-0">
                <span className="block">
                  {tf(c.media.mediaType)} · {formatDateTime(c.media.postedAt, prefs)}
                </span>
                {c.match ? <span className="block text-xs text-primary">{t('dialog.match')}</span> : null}
              </span>
            </label>
          ))}
          {v.mediaId !== null && !candidates.some((c) => c.media.id === v.mediaId) ? (
            <Link href={postLabHref(v.accountId, v.mediaId)} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {t('openPost')}
            </Link>
          ) : null}
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ResponsiveDialogFooter>
        {item ? (
          <Button type="button" variant="outline" className="text-destructive sm:me-auto" onClick={() => setConfirm(true)}>
            {t('dialog.delete')}
          </Button>
        ) : null}
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline">
            {t('dialog.cancel')}
          </Button>
        </ResponsiveDialogClose>
        <LoadingButton type="submit" pending={pending} disabled={v.title.trim() === ''}>
          {t('dialog.save')}
        </LoadingButton>
      </ResponsiveDialogFooter>
      {item ? (
        <ConfirmDialog
          open={confirm}
          title={t('dialog.deleteTitle')}
          body={t('dialog.deleteBody', { title: item.title })}
          confirmLabel={t('dialog.delete')}
          cancelLabel={t('dialog.cancel')}
          busy={pending}
          error={null}
          onConfirm={() => {
            setConfirm(false);
            run(() => remove(item.id), t('dialog.deleted'));
          }}
          onClose={() => setConfirm(false)}
        />
      ) : null}
    </form>
  );
}

/** New (item = null) or edit dialog of one card. Mounted fresh on every opening, so the form starts from the card. */
export function PlannerItemDialog({ open, onClose, ...form }: FormProps & { open: boolean; onClose: () => void }) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <ResponsiveDialogContent className="md:max-h-[90dvh] md:overflow-y-auto">{open ? <ItemForm {...form} /> : null}</ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
