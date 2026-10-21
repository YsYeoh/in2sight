'use client';

// The Followers tab (Plan 15b): follower lists BY NAME from Instagram exports the owner uploads (no API gives names).
// Guide → toolbar (search, the two snapshots, export, upload) → the five lists as underline tabs with counts → one
// server page of the chosen list → the snapshot list (delete). Everything is URL state (lib/followers/state.ts); the
// server computed the page (lib/followers/diff.ts followersView), so at most FOLLOWER_PAGE names reach the browser.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, ExternalLink, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FollowerUpload } from '@/components/account/FollowerUpload';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSearch, FilterSelect, FilterToolbar, useApply, type FilterChip } from '@/components/shared/FilterToolbar';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { downloadExport } from '@/lib/export/download';
import { formatDate, formatDateTime, formatDay, formatNumber } from '@/lib/format';
import { FOLLOWER_LISTS, FOLLOWER_PAGE, sinceKey, type FollowerList, type FollowersView } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';
import { followerHref, staleDays, type FollowerState, type SnapshotMeta } from '@/lib/followers/state';

const GUIDE_STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'] as const;

export interface FollowersTabProps {
  accountId: string;
  username: string;
  today: string;
  scope?: Record<string, string>; // the Time Scope params: carried in every link, never used here
  ready: boolean; // false = the migration is not applied yet
  snapshots: SnapshotMeta[]; // newest first
  state: FollowerState;
  newer: SnapshotMeta | null;
  older: SnapshotMeta | null;
  view: FollowersView | null;
  deleteSnapshot: (accountId: string, snapshotId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}

export function FollowersTab({ accountId, username, today, scope = {}, ready, snapshots, state, newer, older, view, deleteSnapshot }: FollowersTabProps) {
  const t = useTranslations('pages.account.followerDiff');
  const te = useTranslations('export.errors');
  const { prefs } = usePrefs();
  const router = useRouter();
  const apply = useApply();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [target, setTarget] = useState<SnapshotMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const day = (d: string) => formatDay(d, prefs);
  const href = (patch: Partial<FollowerState>) => followerHref(state, patch, scope);

  const guide = (
    <details open={snapshots.length === 0} className="rounded-md border bg-card p-[var(--gp)] text-sm">
      <summary className="cursor-pointer font-medium">{t('guide.title')}</summary>
      <ol className="mt-2 grid list-decimal gap-1.5 ps-5">
        {GUIDE_STEPS.map((s) => (
          <li key={s}>{t(`guide.${s}`, { username })}</li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">{t('guide.privacy')}</p>
    </details>
  );
  const intro = <p className="max-w-prose text-sm text-muted-foreground">{t('intro')}</p>;

  if (!ready)
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {intro}
        {guide}
        <EmptyState icon={<Users aria-hidden="true" />} title={t('notReady')} description={t('notReadyHint')} />
      </div>
    );
  const upload = <FollowerUpload accountId={accountId} username={username} today={today} />;
  if (!newer || !view)
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {intro}
        {guide}
        <EmptyState icon={<Users aria-hidden="true" />} title={t('empty')} description={t('emptyHint')} action={upload} />
      </div>
    );

  const stale = staleDays(snapshots, today);
  const option = (s: SnapshotMeta) => ({ value: s.id, label: t('snapshotOption', { date: day(s.takenOn), count: s.followerCount }) });
  const chips: FilterChip[] = state.q ? [{ id: 'q', label: t('searchChip', { q: state.q }), href: href({ q: '' }) }] : [];
  const exportQuery = new URLSearchParams({ account: accountId, snap: newer.id, ...(older ? { vs: older.id } : {}), list: view.list, ...(state.q ? { q: state.q } : {}) });
  const exportButton = (
    <LoadingButton
      type="button"
      variant="outline"
      pending={exporting}
      disabled={!view.page?.total}
      onClick={async () => {
        setExporting(true);
        const r = await downloadExport(`/api/export/followers?${exportQuery}`, 'xlsx');
        setExporting(false);
        setExportError(r.ok ? null : te(r.error));
      }}
    >
      <Download aria-hidden="true" />
      {t('export')}
    </LoadingButton>
  );
  const columns: Column<Person>[] = [
    {
      key: 'username',
      header: t('cols.username'),
      cell: (p) => (
        <a href={`https://www.instagram.com/${encodeURIComponent(p.username)}/`} target="_blank" rel="noopener noreferrer" aria-label={t('openProfile', { username: p.username })} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
          @{p.username}
          <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </a>
      ),
    },
    { key: 'at', header: t(`cols.${sinceKey(view.list)}`), cell: (p) => formatDate(p.at === null ? null : p.at * 1000, prefs) },
  ];
  const label = (l: FollowerList) => (view.counts[l] === null ? t(`lists.${l}`) : t('withCount', { label: t(`lists.${l}`), count: n(view.counts[l]!) }));
  const unavailable = (l: FollowerList) => (l === 'new' || l === 'lost' ? t('needTwo') : t('needFollowing'));
  const page = view.page;
  const dates = { newer: day(newer.takenOn), older: older ? day(older.takenOn) : '' };

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      {intro}
      {guide}
      {stale !== null ? <p className="text-sm text-muted-foreground">{t('stale', { days: n(stale) })}</p> : null}
      <FilterToolbar label={t('toolbar')} chips={chips} clearHref={state.q ? href({ q: '' }) : undefined} end={<>{exportButton}{upload}</>}>
        <FilterSearch id="followers-q" label={t('search')} placeholder={t('search')} value={state.q} hrefFor={(q) => href({ q })} />
        <FilterSelect id="followers-snap" label={t('snapshot')} value={newer.id} options={snapshots.map(option)} hrefFor={(v) => href({ snap: v })} />
        {snapshots.length > 1 ? <FilterSelect id="followers-vs" label={t('compare')} value={older?.id ?? ''} options={snapshots.filter((s) => s.id !== newer.id).map(option)} hrefFor={(v) => href({ vs: v })} /> : null}
      </FilterToolbar>
      {exportError ? (
        <p role="alert" className="text-xs text-destructive">
          {exportError}
        </p>
      ) : null}
      <Tabs value={view.list} activationMode="manual" onValueChange={(v) => apply(href({ list: v as FollowerList }))} className="min-w-0">
        <TabsList variant="line" aria-label={t('lists.label')}>
          {FOLLOWER_LISTS.map((l) => (
            <TabsTrigger key={l} value={l} className="flex-none">
              {label(l)}
            </TabsTrigger>
          ))}
        </TabsList>
        {FOLLOWER_LISTS.map((l) => (
          <TabsContent key={l} value={l} className="grid min-w-0 gap-2 pt-[var(--gp)]">
            {l !== view.list ? null : !page ? (
              <p className="text-sm text-muted-foreground">{unavailable(l)}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t(`hints.${l}`, dates)}</p>
                {l === 'new' || l === 'lost' ? <p className="text-xs text-muted-foreground">{t('snapshotBased')}</p> : null}
                {page.total > 0 ? (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    {t('range', { first: n((page.page - 1) * FOLLOWER_PAGE + 1), last: n((page.page - 1) * FOLLOWER_PAGE + page.rows.length), total: n(page.total) })}
                  </p>
                ) : null}
                <DataTable
                  rows={page.rows}
                  columns={columns}
                  rowKey={(p) => p.username}
                  caption={t(`lists.${l}`)}
                  empty={<EmptyState title={state.q ? t('emptySearch') : t('emptyList')} />}
                  serverSort={{ current: null, href: () => null }}
                />
                <Pagination page={page.page} pages={page.pages} hrefFor={(p) => href({ page: p })} />
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <section aria-labelledby="follower-snapshots" className="grid min-w-0 gap-2">
        <h2 id="follower-snapshots" className="text-sm font-medium">
          {t('snapshots.title')}
        </h2>
        <DataTable
          rows={snapshots}
          rowKey={(s) => s.id}
          caption={t('snapshots.title')}
          serverSort={{ current: null, href: () => null }}
          columns={[
            { key: 'date', header: t('snapshots.date'), cell: (s) => day(s.takenOn) },
            { key: 'followers', header: t('snapshots.followers'), align: 'right', cell: (s) => n(s.followerCount) },
            { key: 'following', header: t('snapshots.following'), align: 'right', cell: (s) => (s.followingCount === null ? t('snapshots.notUploaded') : n(s.followingCount)) },
            { key: 'uploaded', header: t('snapshots.uploaded'), cell: (s) => formatDateTime(s.createdAt, prefs) },
            {
              key: 'delete',
              header: t('snapshots.delete'),
              cell: (s) => (
                <Button type="button" variant="ghost" size="icon" aria-label={t('snapshots.deleteLabel', { date: day(s.takenOn) })} onClick={() => (setDeleteError(null), setTarget(s))}>
                  <Trash2 aria-hidden="true" />
                </Button>
              ),
            },
          ]}
        />
      </section>
      <ConfirmDialog
        open={target !== null}
        title={t('snapshots.deleteTitle')}
        body={target ? t('snapshots.deleteBody', { date: day(target.takenOn) }) : ''}
        confirmLabel={t('snapshots.confirm')}
        cancelLabel={t('snapshots.cancel')}
        busy={deleting}
        error={deleteError}
        onClose={() => setTarget(null)}
        onConfirm={async () => {
          if (!target) return;
          setDeleting(true);
          const r = await deleteSnapshot(accountId, target.id);
          setDeleting(false);
          if (!r.ok) return setDeleteError(t(`errors.${r.error === 'notFound' ? 'notFound' : 'unexpected'}`, { max: '', file: '' }));
          setTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}
