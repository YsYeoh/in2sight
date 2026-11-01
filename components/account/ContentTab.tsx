'use client';

// The Content tab (Plan 17a): "what works", from the account's own feed posts of the range. Four underline sections:
// Leaderboards, Formats and times, Hashtags, Cadence. Every pick here (section, ranking number, format, grouping) only
// changes what is shown: local state + history.replaceState (UI standard 14; GrowthTab pattern), no server round trip.
// The leaderboard runs in the browser on the model's posts (pure lib/analysis/leaderboard.ts). Every card states its
// source and sample; a missing number shows a dash with its reason, never 0.
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Database, ImageOff, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterSelect, FilterToolbar } from '@/components/shared/FilterToolbar';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FREQ_CAP } from '@/lib/analysis/cadence';
import { BOARD_GROUPS, BOARD_KIND, BOARD_METRICS, leaderboard, NOT_FOR_REELS, type BoardGroup, type BoardMetric, type Ranked } from '@/lib/analysis/leaderboard';
import { FEED_FORMATS } from '@/lib/analysis/posts';
import type { SplitRow } from '@/lib/analysis/splits';
import { CONTENT_SECTIONS, contentHref, parseContentPicks, type ContentLabModel, type ContentPicks, type ContentPost } from '@/lib/dashboard/content-lab';
import type { FeedFormat } from '@/lib/dashboard/content';
import { formatDate, formatDay, formatNumber, formatPercent } from '@/lib/format';
import { postLabHref } from '@/lib/post-lab/params';
import { daysIn } from '@/lib/time-scope/range';

export function ContentTab({ model, accountId, scopeQuery }: { model: ContentLabModel | null; accountId: string; scopeQuery: string }) {
  const t = useTranslations('pages.account.content');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const search = useSearchParams();
  const [picks, setPicks] = useState<ContentPicks>(() => parseContentPicks(new URLSearchParams(search?.toString() ?? '')));

  if (!model) return <EmptyState icon={<Database aria-hidden="true" />} title={t('notReady')} description={t('notReadyHint')} />;
  if (model.posts.length === 0) return <EmptyState icon={<ImageOff aria-hidden="true" />} title={t('empty')} description={t('emptyHint')} />;

  const choose = (patch: Partial<ContentPicks>) => {
    const next = { ...picks, ...patch };
    setPicks(next);
    window.history.replaceState(null, '', contentHref(new URLSearchParams(window.location.search), next));
  };
  const hrefOf = (patch: Partial<ContentPicks>) => contentHref(new URLSearchParams(search?.toString() ?? ''), { ...picks, ...patch });
  const whole = (v: number | null) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const value = (m: BoardMetric, v: number | null) => (BOARD_KIND[m] === 'percent' ? formatPercent(v, prefs) : formatNumber(v, prefs, { maximumFractionDigits: BOARD_KIND[m] === 'per1k' ? 1 : 0 }));
  const tagName = (id: string) => (id === 'untagged' ? t('untagged') : (model.tags.find((x) => x.id === id)?.name ?? '—'));
  const source = <p className="text-xs text-muted-foreground">{t('source', { from: formatDay(model.range.from, prefs), to: formatDay(model.range.to, prefs), count: model.posts.length, measured: whole(model.measured) })}</p>;
  const postCell = (p: ContentPost) => (
    <Link href={postLabHref(accountId, p.id, scopeQuery)} className="flex min-w-0 items-center gap-2 underline-offset-4 hover:underline">
      <MediaThumb media={p} badges={false} className="w-10 shrink-0" />
      <span className="grid min-w-0">
        <span className="truncate">{p.caption ?? ta(`format.${p.mediaType}`)}</span>
        <span className="text-xs text-muted-foreground">{t('postedOn', { date: formatDate(p.postedAt, prefs) })}</span>
      </span>
    </Link>
  );
  const splitTable = (title: string, rows: SplitRow<string>[], label: (k: string) => string) => (
    <ChartCard title={title} subtitle={t('splitSource')}>
      <DataTable
        rows={rows}
        rowKey={(r) => r.key}
        caption={title}
        columns={[
          { key: 'key', header: t('splitKey'), cell: (r) => label(r.key) },
          { key: 'posts', header: t('posts'), cell: (r) => whole(r.posts), align: 'right' },
          { key: 'n', header: t('measured'), cell: (r) => whole(r.n), align: 'right' },
          { key: 'median', header: t('medianReach'), cell: (r) => (r.medianReach === null ? t('fewer') : whole(r.medianReach)), align: 'right' },
        ]}
      />
    </ChartCard>
  );

  function boardPanel() {
    const { metric, format, group } = picks;
    const board = leaderboard(model!.posts, { metric, format, group, tz: prefs.timezone, weekStart: prefs.weekStart });
    const name = t(`metric.${metric}`);
    const groupName = (g: BoardGroup<ContentPost>) => (group === 'week' ? t('weekOf', { day: formatDay(g.key, prefs) }) : tagName(g.key));
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        <FilterToolbar label={t('toolbar')}>
          <FilterSelect id="content-metric" label={t('metricLabel')} value={metric} options={BOARD_METRICS.map((m) => ({ value: m, label: t(`metric.${m}`) }))} hrefFor={(v) => hrefOf({ metric: v as BoardMetric })} onPick={(v) => choose({ metric: v as BoardMetric })} />
          <FilterSelect id="content-format" label={t('formatLabel')} value={format ?? ''} options={[{ value: '', label: t('allFormats') }, ...FEED_FORMATS.map((f) => ({ value: f, label: ta(`format.${f}`) }))]} hrefFor={(v) => hrefOf({ format: (v || null) as FeedFormat | null })} onPick={(v) => choose({ format: (v || null) as FeedFormat | null })} />
          <FilterSelect id="content-group" label={t('group.label')} value={group} options={BOARD_GROUPS.map((g) => ({ value: g, label: t(`group.${g}`) }))} hrefFor={(v) => hrefOf({ group: v as ContentPicks['group'] })} onPick={(v) => choose({ group: v as ContentPicks['group'] })} />
        </FilterToolbar>
        {source}
        <ChartCard title={t('boardTitle', { metric: name })} subtitle={`${t('boardSource', { n: whole(board.n), posts: whole(board.posts) })}${NOT_FOR_REELS.includes(metric) ? ` ${t('notForReels')}` : ''} ${t('repeatHint')}`}>
          {board.groups === null ? (
            <DataTable<Ranked<ContentPost>>
              rows={board.top}
              rowKey={(r) => r.post.id}
              caption={t('boardTitle', { metric: name })}
              empty={t('noValues')}
              columns={[
                { key: 'post', header: t('post'), cell: (r) => postCell(r.post) },
                { key: 'value', header: name, cell: (r) => value(metric, r.value), align: 'right' },
                { key: 'repeat', header: t('repeat'), cell: (r) => (r.repeat ? <Badge variant="secondary">{t('repeat')}</Badge> : null) },
              ]}
            />
          ) : (
            <DataTable<BoardGroup<ContentPost>>
              rows={board.groups}
              rowKey={(g) => g.key}
              caption={t('boardTitle', { metric: name })}
              empty={t('noValues')}
              columns={[
                { key: 'group', header: t(`group.${group}`), cell: groupName },
                { key: 'posts', header: t('posts'), cell: (g) => whole(g.posts), align: 'right' },
                { key: 'median', header: t('median'), cell: (g) => (g.median === null ? t('fewer') : value(metric, g.median)), align: 'right' },
                { key: 'best', header: t('best'), cell: (g) => (g.best ? postCell(g.best.post) : '—') },
              ]}
            />
          )}
        </ChartCard>
        <ChartCard title={t('retireTitle')} subtitle={t('retireSource', { value: value(metric, board.q25) })}>
          {board.retire.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('retireNone')}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {board.retire.map((r) => (
                <li key={`${r.kind}:${r.key}`} className="break-words">
                  {t('retireRow', { name: r.kind === 'format' ? ta(`format.${r.key}`) : tagName(r.key), median: value(metric, r.median), n: r.n })}
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    );
  }

  function formatsPanel() {
    const f = model!.frequency;
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {source}
        <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-2">
          {splitTable(t('formatsTitle'), model!.formats, (k) => ta(`format.${k}`))}
          {splitTable(t('daypartsTitle'), model!.dayparts, (k) => t(`daypart.${k}`))}
          {splitTable(t('captionsTitle'), model!.captions, (k) => t(`band.${k}`))}
          <ChartCard title={t('frequencyTitle')} subtitle={f ? t('frequencySource', { weeks: f.weeks }) : t('frequencyNone')}>
            {f ? (
              <DataTable
                rows={f.rows}
                rowKey={(r) => String(r.perWeek)}
                caption={t('frequencyTitle')}
                columns={[
                  { key: 'perWeek', header: t('postsPerWeek'), cell: (r) => (r.perWeek >= FREQ_CAP ? t('perWeekCap', { count: FREQ_CAP }) : t('perWeek', { count: r.perWeek })) },
                  { key: 'weeks', header: t('weeks'), cell: (r) => whole(r.weeks), align: 'right' },
                  { key: 'median', header: t('medianReach'), cell: (r) => (r.medianReach === null ? t('fewer') : whole(r.medianReach)), align: 'right' },
                ]}
              />
            ) : null}
          </ChartCard>
        </div>
        <p className="text-sm">
          <Link href={`?tab=overview${scopeQuery ? `&${scopeQuery}` : ''}`} className="underline underline-offset-4">
            {t('bestTimeLink')}
          </Link>
        </p>
      </div>
    );
  }

  function hashtagsPanel() {
    const h = model!.hashtags;
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {source}
        <ChartCard title={t('hashtagsTitle')} subtitle={t('hashtagsSource', { withHashtags: whole(h.withHashtags), posts: whole(h.posts), baseline: whole(h.baseline) })}>
          {h.rows === null ? (
            <p className="text-sm text-muted-foreground">{t('hashtagsFew', { measured: whole(h.measured) })}</p>
          ) : (
            <>
              <DataTable
                rows={h.rows}
                rowKey={(r) => r.tag}
                caption={t('hashtagsTitle')}
                empty={t('hashtagsNone')}
                columns={[
                  { key: 'tag', header: t('hashtag'), cell: (r) => <span className="break-words">#{r.tag}</span> },
                  { key: 'posts', header: t('posts'), cell: (r) => whole(r.posts), align: 'right' },
                  { key: 'reach', header: t('medianReach'), cell: (r) => (r.medianReach === null ? t('fewer') : whole(r.medianReach)), align: 'right' },
                  { key: 'saves', header: t('medianSaves'), cell: (r) => (r.medianSaves === null ? t('fewer') : whole(r.medianSaves)), align: 'right' },
                  { key: 'last', header: t('lastUsed'), cell: (r) => formatDate(r.lastUsed, prefs) },
                ]}
              />
              {h.more > 0 ? <p className="mt-2 text-xs text-muted-foreground">{t('hashtagsMore', { count: h.more })}</p> : null}
            </>
          )}
        </ChartCard>
      </div>
    );
  }

  function cadencePanel() {
    const c = model!.cadence;
    const days = (n: number | null) => (n === null ? '—' : t('days', { count: n }));
    const weeks = (n: number) => t('weeksCount', { count: n });
    const item = (label: string, v: string, note?: string) => (
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-lg font-medium tabular-nums">{v}</dd>
        {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
      </div>
    );
    return (
      <div className="grid min-w-0 gap-[var(--gp)]">
        {c.warn && c.sinceLast !== null && c.usualGap !== null ? (
          <p role="status" className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />
            {t('warn', { days: c.sinceLast, usual: formatNumber(c.usualGap, prefs, { maximumFractionDigits: 1 }) })}
          </p>
        ) : null}
        <ChartCard title={t('cadenceTitle')} subtitle={t('cadenceSource', { from: formatDay(c.range.from, prefs), to: formatDay(c.range.to, prefs), count: c.posts })}>
          <dl className="grid grid-cols-2 gap-[var(--gp)] md:grid-cols-3">
            {item(t('postsPerWeek'), formatNumber(c.perWeek, prefs, { maximumFractionDigits: 1 }))}
            {item(t('longestGap'), days(c.longestGap?.days ?? null), c.longestGap ? t('gapDates', { from: formatDay(c.longestGap.from, prefs), to: formatDay(c.longestGap.to, prefs) }) : undefined)}
            {item(t('usualGap'), c.usualGap === null ? '—' : t('days', { count: c.usualGap }), c.usualGap === null ? t('usualGapFew') : undefined)}
            {item(t('sinceLast'), c.sinceLast === null ? t('never') : days(c.sinceLast))}
            {item(t('streak'), c.streak.current === null ? '—' : weeks(c.streak.current), c.streak.current === null ? t('noCurrent') : t('streakHint'))}
            {item(t('bestStreak'), weeks(c.streak.best))}
          </dl>
        </ChartCard>
        <ChartCard title={t('storyDays')}>
          <p className="text-sm">
            {c.stories ? t('storyLine', { days: c.stories.days, total: daysIn(c.stories.range), perWeek: formatNumber(c.stories.perWeek, prefs, { maximumFractionDigits: 1 }), from: formatDay(c.stories.range.from, prefs) }) : t('storyNone')}
          </p>
        </ChartCard>
      </div>
    );
  }

  const panel = { leaderboards: boardPanel, formats: formatsPanel, hashtags: hashtagsPanel, cadence: cadencePanel };
  return (
    <Tabs value={picks.section} onValueChange={(v) => choose({ section: v as ContentPicks['section'] })} className="min-w-0">
      <TabsList variant="line" aria-label={t('sections.label')}>
        {CONTENT_SECTIONS.map((s) => (
          <TabsTrigger key={s} value={s} className="flex-none">
            {t(`sections.${s}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {CONTENT_SECTIONS.map((s) => (
        <TabsContent key={s} value={s} className="min-w-0 pt-[var(--gp)]">
          {s === picks.section ? panel[s]() : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}
