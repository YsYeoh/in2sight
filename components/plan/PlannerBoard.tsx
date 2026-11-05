'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PlannerItemDialog, type PlannerActions, type PlannerMedia } from '@/components/plan/PlannerItemDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSelect, FilterToolbar } from '@/components/shared/FilterToolbar';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import type { Tag } from '@/lib/analysis/types';
import { formatDay, formatHour } from '@/lib/format';
import { boardColumns, stepStatus, type PlannerItem, type PlannerStatus } from '@/lib/planner/items';
import { postLabHref } from '@/lib/post-lab/params';

export interface PlannerBoardProps extends PlannerActions {
  items: PlannerItem[];
  accounts: { id: string; username: string }[]; // live accounts only
  account: string | null; // the account filter (?account=), validated by the page
  basePath?: string; // where the board lives: '/plan', or a section of Plan 17d's page such as '/plan/board'
  tags: Tag[];
  media: PlannerMedia[]; // the live accounts' posts and Stories of the last 30 days: link candidates
}

/** The planner board (Plan 17f): four columns; every move by drag and drop OR by the arrow buttons (keyboard, touch). */
export function PlannerBoard({ items, accounts, account, basePath = '/plan', tags, media, save, move, remove, suggest }: PlannerBoardProps) {
  const t = useTranslations('planner');
  const tErr = useTranslations('planner.errors');
  const tf = useTranslations('analysis.format');
  const { prefs } = usePrefs();
  const [editing, setEditing] = useState<{ item: PlannerItem | null } | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [, start] = useTransition();
  const refocus = useRef<string | null>(null);
  const live = new Set(accounts.map((a) => a.id));
  const shown = items.filter((i) => live.has(i.accountId) && (account === null || i.accountId === account));
  const handle = new Map(accounts.map((a) => [a.id, a.username]));
  const tagById = new Map(tags.map((tg) => [tg.id, tg]));
  const linked = new Map(items.flatMap((i) => (i.mediaId ? [[i.mediaId, i.id] as const] : [])));
  const hrefFor = (v: string) => (v ? `${basePath}${basePath.includes('?') ? '&' : '?'}account=${v}` : basePath); // v = a listed account id

  // A moved card re-renders in another column, which drops the keyboard focus: put it back on the card's title.
  useEffect(() => {
    const id = refocus.current;
    const el = id ? document.querySelector<HTMLElement>(`[data-plan-item="${id}"]`) : null;
    if (el) {
      el.focus();
      refocus.current = null;
    }
  }, [items]);

  const doMove = (it: PlannerItem, to: PlannerStatus) =>
    start(async () => {
      const r = await move(it.id, to);
      if (r.ok) refocus.current = it.id;
      setMessage(r.ok ? { text: t('moved', { title: it.title, column: t(`status.${to}`) }), error: false } : { text: tErr(r.error), error: true });
    });

  if (accounts.length === 0) return <EmptyState title={t('noAccounts')} />;

  return (
    <>
      <FilterToolbar
        label={t('filters')}
        end={
          <Button type="button" onClick={() => setEditing({ item: null })}>
            <Plus aria-hidden />
            {t('new')}
          </Button>
        }
      >
        {accounts.length > 1 ? (
          <FilterSelect
            id="plan-account"
            label={t('account')}
            value={account ?? ''}
            options={[{ value: '', label: t('allAccounts') }, ...accounts.map((a) => ({ value: a.id, label: `@${a.username}` }))]}
            hrefFor={hrefFor}
          />
        ) : null}
      </FilterToolbar>
      <p role={message?.error ? 'alert' : 'status'} className={message?.error ? 'mb-2 text-sm text-destructive' : 'sr-only'}>
        {message?.text}
      </p>

      {shown.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{t('dropHint')}</p>
          <div className="grid gap-[var(--gp)] md:grid-cols-2 xl:grid-cols-4">
            {boardColumns(shown).map((col) => (
              <section
                key={col.status}
                aria-labelledby={`plan-col-${col.status}`}
                className="min-w-0 rounded-[var(--rm)] border border-border bg-muted/40 p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const it = shown.find((x) => x.id === e.dataTransfer.getData('text/plain'));
                  if (it && it.status !== col.status) doMove(it, col.status);
                }}
              >
                <h2 id={`plan-col-${col.status}`} className="mb-2 flex items-baseline justify-between gap-2 px-1 text-sm font-semibold">
                  {t(`status.${col.status}`)}
                  <span className="text-xs font-normal text-muted-foreground">{t('count', { count: col.items.length })}</span>
                </h2>
                {col.items.length === 0 ? <p className="px-1 pb-2 text-xs text-muted-foreground">{t('emptyColumn')}</p> : null}
                <ul className="grid gap-2">
                  {col.items.map((it) => {
                    const prev = stepStatus(it.status, -1);
                    const next = stepStatus(it.status, 1);
                    const itemTags = it.tagIds.flatMap((id) => tagById.get(id) ?? []);
                    return (
                      <li key={it.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', it.id)} className="grid gap-1 rounded-md border border-border bg-card p-2 text-sm">
                        <button
                          type="button"
                          data-plan-item={it.id}
                          aria-label={t('edit', { title: it.title })}
                          className="text-start font-medium break-words hover:underline focus-visible:underline"
                          onClick={() => setEditing({ item: it })}
                        >
                          {it.title}
                        </button>
                        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          {account === null && accounts.length > 1 ? <span>@{handle.get(it.accountId)}</span> : null}
                          {it.format ? <span>{tf(it.format)}</span> : null}
                          {it.plannedDay ? (
                            <span>
                              {formatDay(it.plannedDay, prefs)} {it.plannedHour === null ? t('anyTime') : formatHour(it.plannedHour, prefs)}
                            </span>
                          ) : null}
                        </p>
                        {it.notes ? <p className="line-clamp-2 text-xs whitespace-pre-wrap break-words text-muted-foreground">{it.notes}</p> : null}
                        {itemTags.length ? (
                          <div className="flex flex-wrap gap-1">
                            {itemTags.map((tg) => (
                              <TagBadge key={tg.id} tag={tg} />
                            ))}
                          </div>
                        ) : null}
                        {it.mediaId ? (
                          <Link href={postLabHref(it.accountId, it.mediaId)} className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                            {t('openPost')}
                          </Link>
                        ) : null}
                        <div className="flex justify-between">
                          {prev ? (
                            <Button type="button" variant="ghost" size="sm" aria-label={t('moveTo', { title: it.title, column: t(`status.${prev}`) })} onClick={() => doMove(it, prev)}>
                              <ChevronLeft aria-hidden />
                            </Button>
                          ) : (
                            <span />
                          )}
                          {next ? (
                            <Button type="button" variant="ghost" size="sm" aria-label={t('moveTo', { title: it.title, column: t(`status.${next}`) })} onClick={() => doMove(it, next)}>
                              <ChevronRight aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <PlannerItemDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        item={editing?.item ?? null}
        accountId={account ?? accounts[0].id}
        accounts={accounts}
        tags={tags}
        media={media}
        linked={linked}
        save={save}
        remove={remove}
        suggest={suggest}
        onDone={(text) => {
          setEditing(null);
          setMessage({ text, error: false });
        }}
      />
    </>
  );
}
