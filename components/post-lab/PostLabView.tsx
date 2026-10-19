'use client';

// The Post Lab frame: the back link (keeps the scope), the header (cover, format, account, time, live/expired/gone,
// the whole caption, tags with the tag editor, the Instagram link), the verdict and the two toggles (peers 30/90,
// engagement per reach or per followers — links, so the URL is the state), then the sections of the item's format and
// the similar posts. Wiring only: the model comes from lib/analysis/post-lab.ts.
import Link from 'next/link';
import { ArrowLeft, ChartNoAxesCombined, ExternalLink, FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { TagPicker, type SetPostTags } from '@/components/account/TagPicker';
import { CaptionLab } from '@/components/post-lab/CaptionLab';
import { ScoreTable, VerdictLine } from '@/components/post-lab/Scorecard';
import { StoryPanels } from '@/components/post-lab/StoryPanels';
import { Velocity } from '@/components/post-lab/Velocity';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ChartCard } from '@/components/shared/ChartCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { MediaThumb } from '@/components/shared/MediaThumb';
import { TagBadge } from '@/components/shared/TagBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PEER_COUNTS, type ErBasis, type PostLabModel } from '@/lib/analysis/post-lab';
import type { Tag } from '@/lib/analysis/types';
import { snippet } from '@/lib/dashboard/content';
import { explorerHref, parseExplorerState } from '@/lib/explorer/state';
import { formatCompact, formatDate, formatDateTime } from '@/lib/format';
import { backHref, labQuery, postLabHref, type LabParams } from '@/lib/post-lab/params';
import { cn } from '@/lib/utils';

/** A segmented pair of links (URL state; Tab + Enter work, the current one is aria-current). */
function Toggle({ label, options }: { label: string; options: { href: string; text: string; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex rounded-md border bg-muted p-0.5">
        {options.map((o) => (
          <Link
            key={o.text}
            href={o.href}
            scroll={false}
            aria-current={o.active ? 'true' : undefined}
            className={cn('rounded-sm px-2 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring', o.active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >
            {o.text}
          </Link>
        ))}
      </span>
    </nav>
  );
}

export function PostLabView({ model, account, tags, params, setPostTags }: { model: PostLabModel; account: { id: string; username: string }; tags: Tag[]; params: LabParams; setPostTags: SetPostTags }) {
  const t = useTranslations('postLab');
  const ta = useTranslations('analysis');
  const tt = useTranslations('pages.account.tab');
  const te = useTranslations('explorer.item');
  const { prefs } = usePrefs();
  const { item } = model;
  const story = item.mediaType === 'STORY';
  const format = ta(`format.${item.mediaType}`);
  const label = `${format} · ${formatDateTime(item.postedAt, prefs)}`;
  const own = tags.filter((tag) => item.tagIds.includes(tag.id)).sort((a, b) => a.name.localeCompare(b.name));
  const lab = (patch: Parameters<typeof labQuery>[1]) => postLabHref(account.id, item.id, labQuery(params, patch));
  const query = labQuery(params); // links to other Post Labs keep the scope and the toggles
  const bases: ErBasis[] = ['reach', 'followers'];

  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <Link href={backHref(account.id, story, params)} className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        {t('back', { tab: tt(story ? 'stories' : 'posts') })}
      </Link>

      <Card className="min-w-0">
        <CardContent className="grid min-w-0 gap-[var(--gp)] md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <MediaThumb media={{ ...item, caption: snippet(item.caption), expired: story && !model.live }} className="w-full max-w-72" />
          <div className="grid min-w-0 content-start gap-2">
            <h1 className="flex min-w-0 items-center gap-2 text-[length:calc(var(--fv)*0.8)] leading-tight font-semibold">
              <FlaskConical aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {format} · @{account.username}
              </span>
            </h1>
            <p className="text-xs text-muted-foreground">
              {t('posted', { time: formatDateTime(item.postedAt, prefs) })} · {item.measuredAt ? t('measured', { time: formatDateTime(item.measuredAt, prefs) }) : t('notMeasured')}
            </p>
            {story || item.goneAt ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {story ? <Badge variant={model.live ? 'default' : 'secondary'}>{t(model.live ? 'live' : 'expired')}</Badge> : null}
                {item.goneAt ? (
                  <>
                    <Badge variant="outline">{t('gone')}</Badge>
                    <span className="text-xs text-muted-foreground">{t('goneHint')}</span>
                  </>
                ) : null}
              </div>
            ) : null}
            <p className="max-h-48 overflow-y-auto text-sm break-words whitespace-pre-line" dir="auto">
              {item.caption ?? <span className="text-muted-foreground">{t('noCaption')}</span>}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">{t('tags')}</span>
              {own.map((tag) => (
                <TagBadge key={tag.id} tag={tag} />
              ))}
              <TagPicker postId={item.id} label={label} tags={tags} selected={item.tagIds} setPostTags={setPostTags} />
            </div>
            <div className="flex flex-wrap gap-2">
              {item.permalink ? (
                <Button asChild variant="outline" size="sm">
                  <a href={item.permalink} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" />
                    {t('openInstagram')}
                  </a>
                </Button>
              ) : null}
              {/* the Explorer's item level has the follower curve around the post (Plan 12b) */}
              <Button asChild variant="ghost" size="sm">
                <Link href={explorerHref(parseExplorerState({ by: 'post', acc: account.id, fmt: item.mediaType, item: item.id }), new URLSearchParams(params.scope).toString())}>
                  <ChartNoAxesCombined aria-hidden="true" />
                  {te('followersTitle')}
                </Link>
              </Button>
            </div>
            <VerdictLine verdict={model.verdict} reach={model.scorecard.find((r) => r.id === 'reach')} story={story} />
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <Toggle label={t('compareWith')} options={PEER_COUNTS.map((n) => ({ href: lab({ peers: n }), text: t('peers', { n }), active: params.peers === n }))} />
              {story ? null : <Toggle label={t('erBasis')} options={bases.map((er) => ({ href: lab({ er }), text: t(er === 'reach' ? 'erReach' : 'erFollowers'), active: params.er === er }))} />}
            </div>
          </div>
        </CardContent>
      </Card>

      <ScoreTable title={t('scorecard')} subtitle={t('scorecardHint', { n: model.peers.used })} rows={model.scorecard} />
      {model.watch ? <ScoreTable title={t('watchTitle')} subtitle={t('scorecardHint', { n: model.peers.used })} rows={model.watch} /> : null}
      <Velocity velocity={model.velocity} />
      {model.sequence ? <StoryPanels funnel={model.funnel} sequence={model.sequence} accountId={account.id} query={query} /> : null}
      {model.caption ? <CaptionLab lab={model.caption} /> : null}
      {model.similar.length ? (
        <ChartCard title={t('similar.title')} subtitle={t('similar.hint')}>
          <ul className="grid grid-cols-2 gap-[var(--gp)] sm:grid-cols-3 xl:grid-cols-6">
            {model.similar.map((p) => (
              <li key={p.id} className="min-w-0">
                <Link href={postLabHref(account.id, p.id, query)} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <MediaThumb media={{ ...p, caption: snippet(p.caption) }} className="aspect-square" />
                  <span className="mt-1 block truncate text-xs">{formatDate(p.postedAt, prefs)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{t('reachValue', { value: formatCompact(p.latest?.reach ?? null, prefs) })}</span>
                </Link>
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}
    </div>
  );
}

/** The Post Lab's SQL functions are not there yet (migration not applied): say so, never crash. */
export function PostLabUnavailable({ back }: { back: string }) {
  const t = useTranslations('postLab');
  const tt = useTranslations('pages.account.tab');
  return (
    <EmptyState
      icon={<FlaskConical className="size-5" aria-hidden />}
      title={t('unavailable')}
      description={t('unavailableHint')}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={back}>{t('back', { tab: tt('posts') })}</Link>
        </Button>
      }
    />
  );
}
