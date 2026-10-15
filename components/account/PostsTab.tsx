'use client';

import Form from 'next/form';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TagPicker, type SetPostTags } from '@/components/account/TagPicker';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { FormField } from '@/components/shared/FormField';
import { formHref, startProgress } from '@/components/shared/NavigationProgress';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import type { Tag } from '@/lib/analysis/types';
import type { PostFilters, PostView } from '@/lib/dashboard/content';
import { formatCompact, formatDateTime, formatNumber, formatPercent } from '@/lib/format';

export const POSTS_PAGE = 50;
const SELECT = 'h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground';

/** Filters are a GET form (next/form: a client navigation, still a plain GET without JavaScript): the URL is the state. */
function Filters({ tags, filters }: { tags: Tag[]; filters: PostFilters }) {
  const t = useTranslations('pages.account.posts');
  const ta = useTranslations('analysis');
  return (
    <Form action="" onSubmit={(e) => startProgress(formHref(e.currentTarget))} className="grid grid-cols-2 items-end gap-[var(--gp)] md:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
      <input type="hidden" name="tab" value="posts" />
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
      <FormField id="f-from" label={t('from')}>
        {(p) => <Input {...p} type="date" name="from" defaultValue={filters.from ?? ''} />}
      </FormField>
      <FormField id="f-to" label={t('to')}>
        {(p) => <Input {...p} type="date" name="to" defaultValue={filters.to ?? ''} />}
      </FormField>
      <div className="col-span-2 flex gap-2 md:col-span-1">
        <Button type="submit">{t('apply')}</Button>
        <Button asChild variant="ghost">
          <Link href="?tab=posts">{t('reset')}</Link>
        </Button>
      </div>
    </Form>
  );
}

export function PostsTab({ posts, total, tags, filters, setPostTags }: { posts: PostView[]; total: number; tags: Tag[]; filters: PostFilters; setPostTags: SetPostTags }) {
  const t = useTranslations('pages.account.posts');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const count = (n: number | null) => formatNumber(n, prefs, { maximumFractionDigits: 0 });
  const label = (p: PostView) => `${ta(`format.${p.mediaType}`)} · ${formatDateTime(p.postedAt, prefs)}`;

  const columns: Column<PostView>[] = [
    {
      key: 'post',
      header: t('post'),
      sortValue: (p) => p.postedAt,
      cell: (p) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate">{label(p)}</span>
            {p.permalink ? (
              <a href={p.permalink} target="_blank" rel="noopener noreferrer" aria-label={t('open', { post: label(p) })} className="shrink-0 text-muted-foreground hover:text-foreground">
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            ) : null}
          </span>
          <span className="truncate text-xs font-normal text-muted-foreground" dir="auto">
            {p.caption ?? t('noCaption')}
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
      <Filters tags={tags} filters={filters} />
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('count', { shown: formatNumber(posts.length, prefs), total: formatNumber(total, prefs) })}
      </p>
      <DataTable rows={posts} columns={columns} rowKey={(p) => p.id} caption={t('caption')} empty={t('empty')} initialSort={{ key: 'post', dir: 'desc' }} pageSize={POSTS_PAGE} />
    </div>
  );
}
