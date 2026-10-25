'use client';

// The Comments tab (Plan 15c, READ-ONLY): five views as underline tabs (?section=): All comments, Unanswered questions,
// Fans, Topics, Not following you. Everything is URL state (lib/comments/state.ts); the server read ONE view's page
// (app/(app)/accounts/[id]/(tabs)/page.tsx), so at most one page of third-party names reaches the browser. Every
// analysis view states its source, rule and sample. Without the comments scope nothing is read and the tab says why.
// Plan 15d contract: `renderActions(comment)` fills each CommentRow's action slot.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ExternalLink, MessageSquareOff, MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CommentRow } from '@/components/account/CommentRow';
import { PostedFilter, usePostedName } from '@/components/account/PostedFilter';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FilterOptions, FilterSearch, FilterSelect, FilterToolbar, useApply, type FilterChip } from '@/components/shared/FilterToolbar';
import { Pagination } from '@/components/shared/Pagination';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { COMMENT_ONLY, COMMENT_SECTIONS, commentHref, FAN_MODES, type CommentSection, type CommentState, type FanMode } from '@/lib/comments/state';
import { TOPIC_MIN_AUTHORS, TOPIC_MIN_SAMPLE, type Term, type Topics } from '@/lib/comments/topics';
import { capText, COMMENT_PAGE, FAN_PAGE, FAN_RULES, type CommentPost, type CommentView, type Fan, type Outsider, type Paged } from '@/lib/comments/view';
import { ALL_TIME, pageCount } from '@/lib/dashboard/lists';
import { formatDate, formatDay, formatNumber } from '@/lib/format';

/** What the server read for the current section. */
export type CommentsData =
  | { kind: 'noScope' } // the token lacks the comments scope: nothing was read
  | { kind: 'notReady' } // migration 20261029000001 is not applied (or, for outsiders, the follower exports table is missing)
  | { kind: 'comments'; page: Paged<CommentView>; posts: CommentPost[] } // sections comments and questions
  | { kind: 'fans'; page: Paged<Fan> }
  | { kind: 'topics'; topics: Topics }
  | { kind: 'noSnapshot' } // outsiders without a follower export
  | { kind: 'outsiders'; page: Paged<Outsider>; snapshot: { takenOn: string; followerCount: number } };

export interface CommentsTabProps {
  accountId: string;
  username: string;
  groupName: string | null;
  today: string;
  scope?: Record<string, string>; // the Time Scope params: carried in every link, never used here
  state: CommentState;
  start: string | null; // when comments were first read (ISO); null = none yet
  data: CommentsData;
  renderActions?: (c: CommentView) => ReactNode;
}

const profile = (u: string) => `https://www.instagram.com/${encodeURIComponent(u)}/`;
/** A caption in a select option: at most 40 characters, an ellipsis when cut. */
const snippet = (s: string) => {
  const c = capText(s, 40);
  return c.cut ? `${c.text}…` : c.text;
};

export function CommentsTab({ accountId, username, groupName, today, scope = {}, state, start, data, renderActions }: CommentsTabProps) {
  const t = useTranslations('pages.account.commentInsights');
  const { prefs } = usePrefs();
  const apply = useApply();
  const postedName = usePostedName(state.dates, today);
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });
  const href = (patch: Partial<CommentState>) => commentHref(state, patch, scope);
  const scopeQuery = new URLSearchParams(scope).toString();

  if (data.kind === 'noScope')
    return (
      <EmptyState
        icon={<MessageSquareOff aria-hidden="true" />}
        title={t('noScope.title', { username })}
        description={t('noScope.body')}
        action={
          <Button asChild variant="outline">
            <a href={connectHref(groupName)} target="_top">
              {t('noScope.action')}
            </a>
          </Button>
        }
      />
    );

  const range = (p: Paged<unknown>, size: number, key: 'range' | 'people') =>
    p.total > 0 ? (
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t(key, { first: n((p.page - 1) * size + 1), last: n((p.page - 1) * size + p.rows.length), total: n(p.total) })}
      </p>
    ) : null;
  const pages = (p: Paged<unknown>, size: number) => <Pagination page={p.page} pages={pageCount(p.total, size)} hrefFor={(page) => href({ page })} />;
  const dateFilter = (
    <PostedFilter
      id="comments-date"
      dates={state.dates}
      today={today}
      hrefFor={(dates) => href({ dates })}
      hidden={Object.fromEntries([...new URLSearchParams(href({ dates: ALL_TIME }).slice(1))])}
      label={t('commented', { range: postedName })}
      title={t('commentedTitle')}
    />
  );
  const datesChip: FilterChip[] = state.dates.pr || state.dates.from || state.dates.to ? [{ id: 'dates', label: t('commented', { range: postedName }), href: href({ dates: ALL_TIME }) }] : [];
  const notReady = <EmptyState icon={<MessagesSquare aria-hidden="true" />} title={t('notReady')} description={t('notReadyHint')} />;
  const person = (u: string) => (
    <a href={profile(u)} target="_blank" rel="noopener noreferrer" aria-label={t('openProfile', { username: u })} className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
      @{u}
      <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
    </a>
  );
  const day = (iso: string) => formatDate(iso, prefs);

  function commentList(section: 'comments' | 'questions') {
    if (data.kind !== 'comments') return notReady;
    const { page, posts } = data;
    const known = posts.some((p) => p.id === state.media);
    const options = [
      { value: '', label: t('allPosts') },
      ...posts.map((p) => ({ value: p.id, label: t('postOption', { date: day(p.postedAt), caption: snippet(p.caption ?? t('noCaption')) }) })),
      ...(state.media && !known ? [{ value: state.media, label: t('thisPost') }] : []),
    ];
    const chips: FilterChip[] = [
      ...(state.q ? [{ id: 'q', label: t('searchChip', { q: state.q }), href: href({ q: '' }) }] : []),
      ...datesChip,
      ...(state.media ? [{ id: 'media', label: t('postChip'), href: href({ media: null }) }] : []),
      ...(section === 'comments' && state.only ? [{ id: 'only', label: t(`onlyChip.${state.only}`), href: href({ only: null }) }] : []),
    ];
    return (
      <div className="grid min-w-0 gap-2">
        <FilterToolbar
          label={t('toolbar')}
          chips={chips}
          clearHref={chips.length ? href({ q: '', dates: ALL_TIME, media: null, only: null }) : undefined}
          advanced={
            section === 'comments' ? (
              <FilterOptions label={t('only.label')} options={[null, ...COMMENT_ONLY].map((o) => ({ href: href({ only: o }), label: t(`only.${o ?? 'all'}`), current: state.only === o }))} />
            ) : undefined
          }
          advancedCount={section === 'comments' && state.only ? 1 : 0}
        >
          <FilterSearch id="comments-q" label={t('search')} placeholder={t('search')} value={state.q} hrefFor={(q) => href({ q })} />
          {dateFilter}
          <FilterSelect id="comments-post" label={t('post')} value={state.media ?? ''} options={options} hrefFor={(v) => href({ media: v || null })} />
        </FilterToolbar>
        {section === 'questions' ? <p className="max-w-prose text-xs text-muted-foreground">{t('questionsNote', { username })}</p> : null}
        {range(page, COMMENT_PAGE, 'range')}
        {page.rows.length ? (
          <ul className="grid min-w-0 gap-2">
            {page.rows.map((c) => (
              <li key={c.id} className="min-w-0">
                <CommentRow comment={c} accountId={accountId} scopeQuery={scopeQuery} status={c.hidden ? 'hidden' : undefined} actions={renderActions?.(c)} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<MessagesSquare aria-hidden="true" />}
            title={chips.length ? t('emptySearch') : section === 'questions' ? t('emptyQuestions') : t('empty')}
            description={chips.length ? undefined : t('emptyHint')}
          />
        )}
        {pages(page, COMMENT_PAGE)}
      </div>
    );
  }

  function fans() {
    if (data.kind !== 'fans') return notReady;
    const mode: FanMode = state.fans;
    // Comments are stored from the first read on, so until a whole window has passed everyone with 2+ comments has their first comment inside it
    const windowMs = FAN_RULES.windowDays * 86_400_000;
    const young = mode === 'new' && start !== null && Date.parse(start) > Date.parse(today) - windowMs ? start : null;
    const columns: Column<Fan>[] = [
      { key: 'username', header: t('cols.username'), cell: (f) => person(f.username) },
      { key: 'comments', header: t('cols.comments'), align: 'right', cell: (f) => n(f.comments) },
      { key: 'likes', header: t('cols.likes'), align: 'right', cell: (f) => n(f.likes) },
      { key: 'first', header: t('cols.first'), cell: (f) => day(f.firstAt) },
      { key: 'last', header: t('cols.last'), cell: (f) => day(f.lastAt) },
      ...(mode === 'quiet' ? [{ key: 'since', header: t('cols.postsSince'), align: 'right' as const, cell: (f: Fan) => (f.postsSince === null ? '' : n(f.postsSince)) }] : []),
    ];
    return (
      <div className="grid min-w-0 gap-2">
        <FilterToolbar label={t('fans.toolbar')}>
          <FilterSelect id="comments-fans" label={t('fans.show')} value={mode} options={FAN_MODES.map((m) => ({ value: m, label: t(`fans.${m}`) }))} hrefFor={(v) => href({ fans: v as FanMode })} />
        </FilterToolbar>
        <p className="max-w-prose text-xs text-muted-foreground">{t(`fans.${mode}Rule`, { days: n(FAN_RULES.windowDays), min: n(mode === 'new' ? FAN_RULES.newFanMin : FAN_RULES.fanMin), posts: n(FAN_RULES.quietPosts) })}</p>
        {young ? <p className="max-w-prose text-xs text-muted-foreground">{t('fans.newHistory', { date: day(young), until: day(new Date(Date.parse(young) + windowMs).toISOString()), min: n(FAN_RULES.newFanMin) })}</p> : null}
        {range(data.page, FAN_PAGE, 'people')}
        <DataTable rows={data.page.rows} columns={columns} rowKey={(f) => f.username} caption={t(`fans.${mode}`)} empty={<EmptyState title={t('fans.empty')} />} serverSort={{ current: null, href: () => null }} />
        {pages(data.page, FAN_PAGE)}
      </div>
    );
  }

  function topicList(title: string, terms: Term[]) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          {terms.length ? (
            <ol className="grid gap-1 text-sm">
              {terms.map((x) => (
                <li key={x.term} className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{x.term}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t('topics.inComments', { count: x.comments })}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{t('topics.none')}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  function topics() {
    if (data.kind !== 'topics') return notReady;
    const tp = data.topics;
    return (
      <div className="grid min-w-0 gap-2">
        <FilterToolbar label={t('toolbar')} chips={datesChip} clearHref={datesChip.length ? href({ dates: ALL_TIME }) : undefined}>
          {dateFilter}
        </FilterToolbar>
        <p className="max-w-prose text-xs text-muted-foreground">
          {t('topics.basis', { count: n(tp.sample), authors: n(TOPIC_MIN_AUTHORS) })} {t('topics.ruleBased')}
        </p>
        {tp.enough ? (
          <div className="grid min-w-0 gap-[var(--gp)] lg:grid-cols-3">
            {topicList(t('topics.words'), tp.words)}
            {topicList(t('topics.emoji'), tp.emoji)}
            {topicList(t('topics.hashtags'), tp.hashtags)}
          </div>
        ) : (
          <EmptyState icon={<MessagesSquare aria-hidden="true" />} title={t('topics.tooFew')} description={t('topics.tooFewHint', { min: n(TOPIC_MIN_SAMPLE), count: n(tp.sample) })} />
        )}
      </div>
    );
  }

  function outsiders() {
    if (data.kind === 'noSnapshot')
      return (
        <EmptyState
          icon={<MessagesSquare aria-hidden="true" />}
          title={t('outsiders.noSnapshot')}
          description={t('outsiders.noSnapshotHint')}
          action={
            <Button asChild variant="outline">
              <Link href={`?${new URLSearchParams({ tab: 'followers', ...scope })}`}>{t('outsiders.openFollowers')}</Link>
            </Button>
          }
        />
      );
    if (data.kind !== 'outsiders') return notReady;
    const columns: Column<Outsider>[] = [
      { key: 'username', header: t('cols.username'), cell: (o) => person(o.username) },
      { key: 'comments', header: t('cols.comments'), align: 'right', cell: (o) => n(o.comments) },
      { key: 'last', header: t('cols.last'), cell: (o) => day(o.lastAt) },
    ];
    return (
      <div className="grid min-w-0 gap-2">
        <p className="max-w-prose text-xs text-muted-foreground">{t('outsiders.basis', { date: formatDay(data.snapshot.takenOn, prefs), count: n(data.snapshot.followerCount) })}</p>
        {range(data.page, FAN_PAGE, 'people')}
        <DataTable rows={data.page.rows} columns={columns} rowKey={(o) => o.username} caption={t('sections.outsiders')} empty={<EmptyState title={t('outsiders.empty')} />} serverSort={{ current: null, href: () => null }} />
        {pages(data.page, FAN_PAGE)}
      </div>
    );
  }

  const panel: Record<CommentSection, () => ReactNode> = { comments: () => commentList('comments'), questions: () => commentList('questions'), fans, topics, outsiders };
  return (
    <div className="grid min-w-0 gap-[var(--gp)]">
      <p className="max-w-prose text-sm text-muted-foreground">
        {t('intro')} {start ? t('since', { date: formatDate(start, prefs) }) : null}
      </p>
      <Tabs value={state.section} activationMode="manual" onValueChange={(v) => apply(href({ section: v as CommentSection }))} className="min-w-0">
        <TabsList variant="line" aria-label={t('sections.label')}>
          {COMMENT_SECTIONS.map((s) => (
            <TabsTrigger key={s} value={s} className="flex-none">
              {t(`sections.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {COMMENT_SECTIONS.map((s) => (
          <TabsContent key={s} value={s} className="min-w-0 pt-[var(--gp)]">
            {s === state.section ? panel[s]() : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
