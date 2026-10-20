'use client';

import type { ReactElement } from 'react';
import Link from 'next/link';
import { ExternalLink, FlaskConical, LayoutGrid, Table2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PostedFilter, usePostedName } from '@/components/account/PostedFilter';
import { TagPicker, type SetPostTags } from '@/components/account/TagPicker';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FilterSearch, FilterSelect, FilterToolbar, type FilterChip } from '@/components/shared/FilterToolbar';
import { MediaDrawer } from '@/components/shared/MediaDrawer';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { NavLink } from '@/components/shared/NavLink';
import { Pagination } from '@/components/shared/Pagination';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import type { Tag } from '@/lib/analysis/types';
import type { FeedFormat, PostsView, PostView } from '@/lib/dashboard/content';
import { ALL_TIME, pageCount, POST_SORTS, postHref, postListParams, postPageSize, postSortFor, postSortOf, samePlace, type PostListState, type PostSort, type PostSortKey } from '@/lib/dashboard/lists';
import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
import { formatCompact, formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { cn } from '@/lib/utils';

const TRIGGER = 'rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring';
/** Table columns that have a server sort (ux-polish design §8 call 7); the others are not sortable. */
const SORT_COLUMNS: Record<string, PostSortKey> = { post: 'date', reach: 'reach', views: 'views', er: 'engagement' };

/** Grid | Table as links (URL state like the filters, so Back and shared links keep it): one segmented control, --ctl high. */
function ViewToggle({ current, href, className }: { current: PostsView; href: (v: PostsView) => string; className?: string }) {
  const t = useTranslations('pages.account.posts');
  return (
    <div role="group" aria-label={t('view')} className={cn('flex h-[var(--ctl)] items-center gap-0.5 rounded-md border border-input p-0.5', className)}>
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

/** One page of posts. `total` = how many match the filters; `page` = the page shown; `state` = the list's URL state
 *  (lib/dashboard/lists.ts); `today` = the owner's day (date filter). `scope` = the page's Time Scope params, carried in
 *  every list link (never a filter here). `accountId` set: each post links to its single-item level in the Explorer and
 *  to its Post Lab (no range: ux-polish design §8 call 1). `state.view`: grid or table; null = automatic (grid below md,
 *  table from md). Every cover opens the post's drawer. */
export function PostsTab({
  posts,
  total,
  page,
  state,
  tags,
  today,
  scope = {},
  accountId,
  setPostTags,
}: {
  posts: PostView[];
  total: number;
  page: number;
  state: PostListState;
  tags: Tag[];
  today: string;
  scope?: Record<string, string>;
  accountId?: string;
  setPostTags: SetPostTags;
}) {
  const t = useTranslations('pages.account.posts');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tx = useTranslations('media');
  const tl = useTranslations('postLab');
  const { prefs } = usePrefs();
  const posted = usePostedName(state.dates, today);
  const count = (n: number | null) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
  const label = (p: PostView) => `${ta(`format.${p.mediaType}`)} · ${formatDateTime(p.postedAt, prefs)}`;
  const href = (patch: Partial<PostListState>) => postHref(state, patch, scope);
  const size = postPageSize(state.view);
  const viewHref = (v: PostsView) => href({ view: v, page: samePlace(page, size, postPageSize(v)) });
  const sort = postSortOf(state.sort);
  const tagName = (id: string) => (id === 'untagged' ? t('untagged') : (tags.find((x) => x.id === id)?.name ?? id));
  const chips: FilterChip[] = [
    ...(state.q ? [{ id: 'q', label: t('searchChip', { q: state.q }), href: href({ q: '' }) }] : []),
    ...(state.dates.pr || state.dates.from || state.dates.to ? [{ id: 'posted', label: posted, href: href({ dates: ALL_TIME }) }] : []),
    ...(state.format ? [{ id: 'format', label: ta(`format.${state.format}`), href: href({ format: null }) }] : []),
    ...(state.tag ? [{ id: 'tag', label: tagName(state.tag), href: href({ tag: null }) }] : []),
  ];
  const explorer = (p: PostView) => explorerHref(parseExplorerState({ by: 'post', acc: accountId, fmt: p.mediaType, item: p.id }), '');
  /** The post's Post Lab: a small flask link next to the title / date (accessible name = "Open the Post Lab of …"). */
  const labLink = (p: PostView) =>
    accountId ? (
      <Link href={postLabHref(accountId, p.id)} aria-label={tl('openFor', { post: label(p) })} className="shrink-0 text-muted-foreground hover:text-foreground">
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
            <Link href={postLabHref(accountId, p.id)}>
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
    { key: 'reach', header: tm('reach'), cell: (p) => formatCompact(p.reach, prefs), align: 'right' },
    { key: 'views', header: tm('views'), cell: (p) => formatCompact(p.views, prefs), align: 'right' },
    { key: 'likes', header: t('likes'), cell: (p) => count(p.likes), align: 'right' },
    { key: 'comments', header: t('comments'), cell: (p) => count(p.comments), align: 'right' },
    { key: 'saves', header: t('saves'), cell: (p) => count(p.saves), align: 'right' },
    { key: 'shares', header: t('shares'), cell: (p) => count(p.shares), align: 'right' },
    { key: 'er', header: tm('engagementRate'), cell: (p) => formatPercent(p.engagementRate, prefs), align: 'right' },
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
      {/* the custom-dates form keeps every other parameter as hidden fields */}
      <FilterToolbar
        label={t('filters')}
        chips={chips}
        clearHref={href({ q: '', dates: ALL_TIME, format: null, tag: null })}
        end={
          state.view ? (
            <ViewToggle current={state.view} href={viewHref} />
          ) : (
            <>
              {/* automatic: the toggle shows the view each width gets (CSS only); a choice applies at every width */}
              <ViewToggle current="grid" href={viewHref} className="md:hidden" />
              <ViewToggle current="table" href={viewHref} className="max-md:hidden" />
            </>
          )
        }
      >
        <FilterSearch id="posts-q" label={t('search')} placeholder={t('search')} value={state.q} hrefFor={(q) => href({ q })} />
        <PostedFilter id="posts-posted" dates={state.dates} today={today} hrefFor={(dates) => href({ dates })} hidden={postListParams({ ...state, dates: ALL_TIME, page: 1 }, scope)} />
        <FilterSelect id="posts-format" label={t('format')} value={state.format ?? ''} options={[{ value: '', label: t('all') }, ...FEED_FORMATS.map((f) => ({ value: f, label: ta(`format.${f}`) }))]} hrefFor={(v) => href({ format: (v || null) as FeedFormat | null })} />
        <FilterSelect id="posts-tag" label={t('tag')} value={state.tag ?? ''} options={[{ value: '', label: t('all') }, { value: 'untagged', label: t('untagged') }, ...tags.map((x) => ({ value: x.id, label: x.name }))]} hrefFor={(v) => href({ tag: v || null })} />
        <FilterSelect id="posts-sort" label={t('sort')} value={state.sort} options={POST_SORTS.map((v) => ({ value: v, label: t(`sorts.${v}`) }))} hrefFor={(v) => href({ sort: v as PostSort })} />
      </FilterToolbar>
      {total > 0 ? (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t('range', { first: count((page - 1) * size + 1), last: count((page - 1) * size + posts.length), total: count(total) })}
        </p>
      ) : null}
      <DataTable
        rows={posts}
        columns={columns}
        rowKey={(p) => p.id}
        caption={t('caption')}
        empty={t('empty')}
        tile={tile}
        view={state.view ?? 'auto'}
        serverSort={{
          current: { key: Object.keys(SORT_COLUMNS).find((k) => SORT_COLUMNS[k] === sort.key) ?? 'post', dir: sort.asc ? 'asc' : 'desc' },
          href: (key) => (SORT_COLUMNS[key] ? href({ sort: postSortFor(SORT_COLUMNS[key], SORT_COLUMNS[key] === sort.key ? !sort.asc : false) }) : null),
        }}
      />
      <Pagination page={page} pages={pageCount(total, size)} hrefFor={(p) => href({ page: p })} />
    </div>
  );
}
