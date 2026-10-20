'use client';

// Stories as a filmstrip per owner-timezone day (creator-toolkit spec §4): days newest first, the Stories of a day in
// the order they played, left to right. Each frame is its cover (it opens the Story's drawer) with the key numbers
// under it; the views curve lives in the drawer (a frame is too narrow for it). With the account id, each Story links to
// its Post Lab (the drawer's action and a small flask link; no range, ux-polish design §8 call 1).
// Own filters (Plan 14b): posted date, sort, measured; "Newest" pages by 7 whole days, the other sorts are a flat list
// of 48 Stories per page, each frame showing its date. The list state is the URL (lib/dashboard/lists.ts).
import Link from 'next/link';
import { ExternalLink, Film, FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { PostedFilter, usePostedName } from '@/components/account/PostedFilter';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSelect, FilterToolbar, type FilterChip } from '@/components/shared/FilterToolbar';
import { MediaDrawer } from '@/components/shared/MediaDrawer';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { Pagination } from '@/components/shared/Pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { storyDays, type StoryView } from '@/lib/dashboard/content';
import { ALL_TIME, pageCount, STORY_SORTS, storyHref, storyListParams, storyPageSize, type StoryListState, type StorySort } from '@/lib/dashboard/lists';
import { formatCompact, formatDateTime, formatDay, formatNumber, formatPercent, formatTime } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';

/** `withDate`: the flat list (sorted by views or exit rate) shows the date with the time; the filmstrip has day headings. */
function Frame({ s, lab, withDate = false }: { s: StoryView; lab: string | null; withDate?: boolean }) {
  const t = useTranslations('pages.account.stories');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tx = useTranslations('media');
  const tl = useTranslations('postLab');
  const { prefs } = usePrefs();
  const f = s.final;
  const title = `${ta('format.STORY')} · ${formatDateTime(s.postedAt, prefs)}`;
  const hint = s.live ? t('liveHint', { count: s.snapshots }) : t('finalHint', { count: s.snapshots });
  const media = { id: s.id, mediaType: 'STORY' as const, cover: s.cover, expired: !s.live };
  const all = [
    [tm('views'), formatCompact(f?.views ?? null, prefs)],
    [tm('reach'), formatCompact(f?.reach ?? null, prefs)],
    [t('replies'), formatNumber(f?.replies ?? null, prefs)],
    [t('exitRate'), formatPercent(s.exitRate, prefs)],
    [t('shares'), formatNumber(f?.shares ?? null, prefs)],
    [t('tapsForward'), formatNumber(f?.tapsForward ?? null, prefs)],
  ] as const;
  return (
    <div className="grid min-w-0 gap-1.5">
      <MediaDrawer
        media={media}
        title={title}
        description={s.reason ? ta(`reasons.${s.reason}`) : hint}
        permalink={s.permalink}
        stats={s.reason ? [] : all.map(([label, value]) => ({ label, value }))}
        trigger={
          <button type="button" aria-label={tx('details', { name: s.live ? title : `${title} · ${t('expired')}` })} className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MediaThumb media={media} />
          </button>
        }
        action={
          lab ? (
            <Button asChild size="sm">
              <Link href={lab}>
                <FlaskConical aria-hidden="true" />
                {tl('open')}
              </Link>
            </Button>
          ) : undefined
        }
      >
        {s.reason ? null : <Sparkline data={s.progression} className="text-chart-2" />}
      </MediaDrawer>
      <div className="flex min-w-0 items-center justify-between gap-1">
        <span className="truncate text-xs font-medium tabular-nums">{withDate ? formatDateTime(s.postedAt, prefs) : formatTime(s.postedAt, prefs)}</span>
        {s.live ? <Badge>{t('live')}</Badge> : null}
      </div>
      {s.reason ? (
        <p className="text-xs text-muted-foreground">{ta(`reasons.${s.reason}`)}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          {all.slice(0, 4).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate text-muted-foreground">{label}</dt>
              <dd className="truncate font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex min-w-0 items-center justify-between gap-1 text-[10px] text-muted-foreground">
        <span className="truncate">{hint}</span>
        {lab ? (
          <Link href={lab} aria-label={tl('openFor', { post: title })} className="shrink-0 hover:text-foreground">
            <FlaskConical aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
        {s.permalink ? (
          <a href={s.permalink} target="_blank" rel="noopener noreferrer" aria-label={t('open', { time: formatDateTime(s.postedAt, prefs) })} className="shrink-0 hover:text-foreground">
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        ) : null}
      </div>
    </div>
  );
}

const MEASURED = { '': null, yes: true, no: false } as const;

/** One page of Stories. `items` / `days` = how many Stories / owner-timezone days match (the pages count days for
 *  "Newest"); `page` = the page shown; `state` = the list's URL state; `today` = the owner's day (date filter).
 *  `truncated`: the fallback read before the migration stopped at STORY_LIMIT; said out loud, never silent.
 *  `scope` = the page's Time Scope params, carried in every list link (never a filter here).
 *  `accountId` set: each Story links to its Post Lab. */
export function StoriesTab({
  stories,
  items,
  days,
  page,
  state,
  today,
  truncated = false,
  accountId,
  scope = {},
}: {
  stories: StoryView[];
  items: number;
  days: number;
  page: number;
  state: StoryListState;
  today: string;
  truncated?: boolean;
  accountId?: string;
  scope?: Record<string, string>;
}) {
  const t = useTranslations('pages.account.stories');
  const { prefs } = usePrefs();
  const posted = usePostedName(state.dates, today);
  const href = (patch: Partial<StoryListState>) => storyHref(state, patch, scope);
  const measured = state.measured === null ? '' : state.measured ? 'yes' : 'no';
  const chips: FilterChip[] = [
    ...(state.dates.pr || state.dates.from || state.dates.to ? [{ id: 'posted', label: posted, href: href({ dates: ALL_TIME }) }] : []),
    ...(measured ? [{ id: 'measured', label: t(`measuredOptions.${measured}`), href: href({ measured: null }) }] : []),
  ];
  const lab = (s: StoryView) => (accountId ? postLabHref(accountId, s.id) : null);

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <FilterToolbar label={t('filters')} chips={chips} clearHref={href({ dates: ALL_TIME, measured: null })}>
        <PostedFilter id="stories-posted" dates={state.dates} today={today} hrefFor={(dates) => href({ dates })} hidden={storyListParams({ ...state, dates: ALL_TIME, page: 1 }, scope)} />
        <FilterSelect id="stories-sort" label={t('sort')} value={state.sort} options={STORY_SORTS.map((v) => ({ value: v, label: t(`sorts.${v}`) }))} hrefFor={(v) => href({ sort: v as StorySort })} />
        <FilterSelect id="stories-measured" label={t('measured')} value={measured} options={(['', 'yes', 'no'] as const).map((v) => ({ value: v, label: t(`measuredOptions.${v || 'all'}`) }))} hrefFor={(v) => href({ measured: MEASURED[v as keyof typeof MEASURED] })} />
      </FilterToolbar>
      {stories.length === 0 ? (
        <EmptyState icon={<Film className="size-5" aria-hidden />} title={chips.length ? t('emptyFiltered') : t('empty')} description={t('emptyHint')} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('summary', { count: formatNumber(items, prefs) })}</p>
          {truncated ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t('truncated', { count: formatNumber(stories.length, prefs) })}
            </p>
          ) : null}
          {state.sort === 'newest' ? (
            storyDays(stories, prefs.timezone).map((d) => (
              <section key={d.day} aria-labelledby={`stories-${d.day}`} className="grid min-w-0 gap-2">
                <h3 id={`stories-${d.day}`} className="text-sm font-medium">
                  {t('day', { date: formatDay(d.day, prefs), count: d.stories.length })}
                </h3>
                <ol className="flex min-w-0 snap-x gap-[var(--gp)] overflow-x-auto pb-2">
                  {d.stories.map((s) => (
                    <li key={s.id} className="w-32 shrink-0 snap-start sm:w-36">
                      <Frame s={s} lab={lab(s)} />
                    </li>
                  ))}
                </ol>
              </section>
            ))
          ) : (
            <ol aria-label={t('list')} className="grid grid-cols-2 gap-[var(--gp)] sm:grid-cols-4 lg:grid-cols-6">
              {stories.map((s) => (
                <li key={s.id} className="min-w-0">
                  <Frame s={s} lab={lab(s)} withDate />
                </li>
              ))}
            </ol>
          )}
          <Pagination page={page} pages={pageCount(state.sort === 'newest' ? days : items, storyPageSize(state.sort))} hrefFor={(p) => href({ page: p })} />
        </>
      )}
    </div>
  );
}
