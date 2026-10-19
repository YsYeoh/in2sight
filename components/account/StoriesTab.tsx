'use client';

// Stories as a filmstrip per owner-timezone day (creator-toolkit spec §4): days newest first, the Stories of a day in
// the order they played, left to right. Each frame is its cover (it opens the Story's drawer) with the key numbers
// under it; the views curve lives in the drawer (a frame is too narrow for it). With the account id, each Story links to
// its Post Lab (the drawer's action and a small flask link), keeping the page's scope.
import Link from 'next/link';
import { ExternalLink, Film, FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sparkline } from '@/components/charts/Sparkline';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { MediaDrawer } from '@/components/shared/MediaDrawer';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { storyDays, type StoryView } from '@/lib/dashboard/content';
import { formatCompact, formatDateTime, formatDay, formatNumber, formatPercent, formatTime } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';

function Frame({ s, lab }: { s: StoryView; lab: string | null }) {
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
          <button type="button" aria-label={tx('details', { name: title })} className="block w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
        <span className="truncate text-xs font-medium tabular-nums">{formatTime(s.postedAt, prefs)}</span>
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

/** `truncated`: the range holds more Stories than are read (STORY_LIMIT); said out loud, never silent.
 *  `accountId` set: each Story links to its Post Lab with `scope` (the page's canonical Time Scope parameters). */
export function StoriesTab({ stories, truncated = false, accountId, scope = {} }: { stories: StoryView[]; truncated?: boolean; accountId?: string; scope?: Record<string, string> }) {
  const t = useTranslations('pages.account.stories');
  const { prefs } = usePrefs();
  const query = new URLSearchParams(scope).toString();

  if (stories.length === 0) return <EmptyState icon={<Film className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />;

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="text-xs text-muted-foreground">{t('summary', { count: formatNumber(stories.length, prefs) })}</p>
      {truncated ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t('truncated', { count: formatNumber(stories.length, prefs) })}
        </p>
      ) : null}
      {storyDays(stories, prefs.timezone).map((d) => (
        <section key={d.day} aria-labelledby={`stories-${d.day}`} className="grid min-w-0 gap-2">
          <h3 id={`stories-${d.day}`} className="text-sm font-medium">
            {t('day', { date: formatDay(d.day, prefs), count: d.stories.length })}
          </h3>
          <ol className="flex min-w-0 snap-x gap-[var(--gp)] overflow-x-auto pb-2">
            {d.stories.map((s) => (
              <li key={s.id} className="w-32 shrink-0 snap-start sm:w-36">
                <Frame s={s} lab={accountId ? postLabHref(accountId, s.id, query) : null} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
