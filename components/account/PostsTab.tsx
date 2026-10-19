'use client';

import type { ReactElement } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { ExternalLink, FlaskConical, LayoutGrid, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TagPicker, type SetPostTags } from '@/components/account/TagPicker';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FormField } from '@/components/shared/FormField';
import { MediaDrawer } from '@/components/shared/MediaDrawer';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { NavLink } from '@/components/shared/NavLink';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import type { Tag } from '@/lib/analysis/types';
import type { PostFilters, PostsView, PostView } from '@/lib/dashboard/content';
import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
import { formatCompact, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { cn } from '@/lib/utils';

export const POSTS_PAGE = 50;
const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';
const TRIGGER = 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Filters are a GET form (next/form: a client navigation, still a plain GET without JavaScript): the URL is the state.
 *  The dates are the page's Time Scope (the bar above) and `keep` the chosen view, carried as hidden fields. */
function Filters({ tags, filters, keep }: { tags: Tag[]; filters: PostFilters; keep: Record<string, string> }) {
  const t = useTranslations('pages.account.posts');
  const ta = useTranslations('analysis');
  const query = new URLSearchParams(keep).toString();
  return (
    <Form action="" onSubmit={(e) => startProgress(formHref(e.currentTarget))} className="grid grid-cols-2 items-end gap-[var(--gp)] md:grid-cols-[repeat(2,minmax(0,1fr))_auto]">
      <input type="hidden" name="tab" value="posts" />
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <FormField id="f-format" label={t('format')}>
        {(p) => (
          <select {...p} name="format" defaultValue={filters.format ?? ''} className={SELECT}>
            <option value="">{t('all')}</option>
            {FEED_FORMATS.map((f) => (
              <option key={f} value={f}>
                {ta(`format.${f}`)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField id="f-tag" label={t('tag')}>
        {(p) => (
          <select {...p} name="tag" defaultValue={filters.tag ?? ''} className={SELECT}>
            <option value="">{t('all')}</option>
            <option value="untagged">{t('untagged')}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <div className="col-span-2 flex gap-2 md:col-span-1">
        <Button type="submit">{t('apply')}</Button>
        <Button asChild variant="ghost">
          <Link href={`?tab=posts${query ? `&${query}` : ''}`}>{t('reset')}</Link>
        </Button>
      </div>
    </Form>
  );
}

/** Grid | Table as links (URL state like the filters, so Back and shared links keep it). */
function ViewToggle({ current, href, className }: { current: PostsView; href: (v: PostsView) => string; className?: string }) {
  const t = useTranslations('pages.account.posts');
  return (
    <div role="group" aria-label={t('view')} className={cn('flex gap-1', className)}>
      {(['grid', 'table'] as const).map((v) => {
        const Icon = v === 'grid' ? LayoutGrid : Table2;
        return (
          <Button key={v} asChild size="sm" variant={v === current ? 'secondary' : 'ghost'}>
            <Link href={href(v)} scroll={false} aria-current={v === current ? 'true' : undefined}>
              <Icon aria-hidden="true" />
              {t(v)}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}

/** `scope` = the canonical Time Scope parameters of the page (ResolvedScope.params), kept by the filter form.
 *  `accountId` set: each post links to its single-item level in the Explorer and to its Post Lab (both with the page's scope).
 *  `view`: grid or table from `?view=`; null = automatic (grid below md, table from md). Every cover opens the post's drawer. */
export function PostsTab({
  posts,
  total,
  tags,
  filters,
  scope = {},
  accountId,
  view = null,
  setPostTags,
}: {
  posts: PostView[];
  total: number;
  tags: Tag[];
  filters: PostFilters;
  scope?: Record<string, string>;
  accountId?: string;
  view?: PostsView | null;
  setPostTags: SetPostTags;
}) {
  const t = useTranslations('pages.account.posts');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tx = useTranslations('media');
  const tl = useTranslations('postLab');
  const { prefs } = usePrefs();
  const count = (n: number | null) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
  const label = (p: PostView) => `${ta(`format.${p.mediaType}`)} · ${formatDateTime(p.postedAt, prefs)}`;
  const query = new URLSearchParams(scope).toString();
  const keep = view ? { ...scope, view } : scope;
  const viewHref = (v: PostsView) => `?${new URLSearchParams({ tab: 'posts', ...(filters.format ? { format: filters.format } : {}), ...(filters.tag ? { tag: filters.tag } : {}), ...scope, view: v })}`;
  const explorer = (p: PostView) => explorerHref(parseExplorerState({ by: 'post', acc: accountId, fmt: p.mediaType, item: p.id }), query);
  /** The post's Post Lab: a small flask link next to the title / date (accessible name = "Open the Post Lab of …"). */
  const labLink = (p: PostView) =>
    accountId ? (
      <Link href={postLabHref(accountId, p.id, query)} aria-label={tl('openFor', { post: label(p) })} className="shrink-0 text-muted-foreground hover:text-foreground">
        <FlaskConical aria-hidden="true" className="size-3.5" />
      </Link>
    ) : null;

  // one drawer per post (content mounts only while open), opened by the cover button of a tile or a table row
  const detail = (p: PostView, trigger: ReactElement) => (
    <MediaDrawer
      media={p}
      title={label(p)}
      description={p.caption ?? t('noCaption')}
      permalink={p.permalink}
      stats={[
        { label: tm('reach'), value: formatCompact(p.reach, prefs) },
        { label: tm('views'), value: formatCompact(p.views, prefs) },
        { label: tm('engagementRate'), value: formatPercent(p.engagementRate, prefs) },
        { label: t('likes'), value: count(p.likes) },
        { label: t('comments'), value: count(p.comments) },
        { label: t('saves'), value: count(p.saves) },
        { label: t('shares'), value: count(p.shares) },
      ]}
      trigger={trigger}
      action={
        accountId ? (
          <Button asChild size="sm">
            <Link href={postLabHref(accountId, p.id, query)}>
              <FlaskConical aria-hidden="true" />
              {tl('open')}
            </Link>
          </Button>
        ) : undefined
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        <span className="mr-1 text-xs text-muted-foreground">{t('tags')}</span>
        {p.tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} />
        ))}
        <TagPicker postId={p.id} label={label(p)} tags={tags} selected={p.tags.map((x) => x.id)} setPostTags={setPostTags} />
      </div>
    </MediaDrawer>
  );

  const tile = (p: PostView) => (
    <div className="grid min-w-0 gap-1">
      {detail(
        p,
        <button type="button" aria-label={tx('details', { name: label(p) })} className={cn('block w-full', TRIGGER)}>
          <MediaThumb media={p} className="aspect-[4/5]" />
        </button>,
      )}
      {accountId ? (
        <span className="flex min-w-0 items-center justify-between gap-1">
          <NavLink href={explorer(p)} className="truncate text-xs font-medium underline-offset-4 hover:underline">
            {formatDateTime(p.postedAt, prefs)}
          </NavLink>
          {labLink(p)}
        </span>
      ) : (
        <span className="truncate text-xs font-medium">{formatDateTime(p.postedAt, prefs)}</span>
      )}
      <dl className="grid grid-cols-2 gap-x-2 text-xs">
        <div className="min-w-0">
          <dt className="truncate text-muted-foreground">{tm('reach')}</dt>
          <dd className="truncate font-medium tabular-nums">{formatCompact(p.reach, prefs)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-muted-foreground">{tm('engagementRate')}</dt>
          <dd className="truncate font-medium tabular-nums">{formatPercent(p.engagementRate, prefs)}</dd>
        </div>
      </dl>
    </div>
  );

  const columns: Column<PostView>[] = [
    {
      key: 'post',
      header: t('post'),
      sortValue: (p) => p.postedAt,
      cell: (p) => (
        <span className="flex min-w-0 items-center gap-2">
          {detail(
            p,
            <button type="button" aria-label={tx('details', { name: label(p) })} className={cn('shrink-0', TRIGGER)}>
              <MediaThumb media={p} className="aspect-square w-9" badges={false} />
            </button>,
          )}
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              {accountId ? (
                <NavLink href={explorer(p)} className="truncate underline-offset-4 hover:underline">
                  {label(p)}
                </NavLink>
              ) : (
                <span className="truncate">{label(p)}</span>
              )}
              {p.permalink ? (
                <a href={p.permalink} target="_blank" rel="noopener noreferrer" aria-label={t('open', { post: label(p) })} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              ) : null}
              {labLink(p)}
            </span>
            <span className="truncate text-xs font-normal text-muted-foreground" dir="auto">
              {p.caption ?? t('noCaption')}
            </span>
          </span>
        </span>
      ),
    },
    { key: 'reach', header: tm('reach'), sortValue: (p) => p.reach, cell: (p) => formatCompact(p.reach, prefs), align: 'right' },
    { key: 'views', header: tm('views'), sortValue: (p) => p.views, cell: (p) => formatCompact(p.views, prefs), align: 'right' },
    { key: 'likes', header: t('likes'), sortValue: (p) => p.likes, cell: (p) => count(p.likes), align: 'right' },
    { key: 'comments', header: t('comments'), sortValue: (p) => p.comments, cell: (p) => count(p.comments), align: 'right' },
    { key: 'saves', header: t('saves'), sortValue: (p) => p.saves, cell: (p) => count(p.saves), align: 'right' },
    { key: 'shares', header: t('shares'), sortValue: (p) => p.shares, cell: (p) => count(p.shares), align: 'right' },
    { key: 'er', header: tm('engagementRate'), sortValue: (p) => p.engagementRate, cell: (p) => formatPercent(p.engagementRate, prefs), align: 'right' },
    {
      key: 'tags',
      header: t('tags'),
      cell: (p) => (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {p.tags.map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
          <TagPicker postId={p.id} label={label(p)} tags={tags} selected={p.tags.map((x) => x.id)} setPostTags={setPostTags} />
        </span>
      ),
    },
  ];

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <Filters tags={tags} filters={filters} keep={keep} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t('count', { shown: formatNumber(posts.length, prefs), total: formatNumber(total, prefs) })}
        </p>
        {/* automatic: the toggle shows the view each width gets (CSS only); a choice applies at every width */}
        {view ? (
          <ViewToggle current={view} href={viewHref} />
        ) : (
          <>
            <ViewToggle current="grid" href={viewHref} className="md:hidden" />
            <ViewToggle current="table" href={viewHref} className="max-md:hidden" />
          </>
        )}
      </div>
      <DataTable rows={posts} columns={columns} rowKey={(p) => p.id} caption={t('caption')} empty={t('empty')} initialSort={{ key: 'post', dir: 'desc' }} pageSize={POSTS_PAGE} tile={tile} view={view ?? 'auto'} />
    </div>
  );
}
