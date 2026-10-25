import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { CommentsTab, type CommentsData, type CommentsTabProps } from '@/components/account/CommentsTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { parseCommentState } from '@/lib/comments/state';
import type { CommentView } from '@/lib/comments/view';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { push, replace, refresh } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push, replace, refresh, prefetch: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  for (const f of [push, replace, refresh]) f.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T = en.pages.account.commentInsights;
const ACC = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const SCOPE = { from: '2026-09-01', to: '2026-09-30' };
const comment = (i: number, o: Partial<CommentView> = {}): CommentView => ({
  id: `c${i}`,
  mediaId: '1790',
  authorUsername: `fan${i}`,
  text: `comment ${i}`,
  postedAt: '2026-10-20T08:00:00Z',
  likeCount: null,
  isQuestion: false,
  hidden: null,
  repliedByOwner: null,
  post: { id: '1790', type: 'IMAGE', postedAt: '2026-10-19T10:00:00Z', caption: 'Penang' },
  ...o,
});
const POSTS = [{ id: '1790', type: 'IMAGE', postedAt: '2026-10-19T10:00:00Z', caption: 'Penang street food, the long caption that is cut' }];

function props(sp: Record<string, string>, data: CommentsData, o: Partial<CommentsTabProps> = {}): CommentsTabProps {
  return { accountId: ACC, username: 'shop.one', groupName: 'Brand X', today: '2026-10-25', scope: SCOPE, state: parseCommentState(sp), start: '2026-10-02T03:00:00Z', data, ...o };
}
function view(p: CommentsTabProps, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale, dateFormat: 'YYYY-MM-DD' }} persist={vi.fn()}>
        <CommentsTab {...p} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const page = <R,>(rows: R[], total = rows.length, n = 1) => ({ rows, total, page: n });

describe('CommentsTab', () => {
  it('without the comments scope: nothing else, the reason, and the reconnect link (keeps the group, leaves the frame)', () => {
    view(props({}, { kind: 'noScope' }));
    expect(screen.getByText('Comments are off for @shop.one')).toBeInTheDocument();
    expect(screen.getByText(T.noScope.body)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: T.noScope.action });
    expect(link).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20X');
    expect(link).toHaveAttribute('target', '_top');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('All comments: intro + since, five underline views, the toolbar, the count line, rows with the Post Lab link, pages that keep the scope', () => {
    view(props({ page: '2' }, { kind: 'comments', page: page([comment(1), comment(2)], 52, 2), posts: POSTS }));
    expect(screen.getByText(/Comments read since 2026-10-02\./)).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((x) => x.textContent)).toEqual(['All comments', 'Unanswered questions', 'Fans', 'Topics', 'Not following you']);
    expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'line');
    const toolbar = screen.getByRole('group', { name: T.toolbar });
    expect(within(toolbar).getByRole('searchbox', { name: T.search })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Commented: All time' })).toBeInTheDocument();
    const post = within(toolbar).getByRole('combobox', { name: T.post });
    expect(within(post).getAllByRole('option').map((o) => o.textContent)).toEqual(['All posts', '2026-10-19 · Penang street food, the long caption tha…']);
    expect(screen.getByText('51–52 of 52 comments')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'On your post of 2026-10-19' })[0]).toHaveAttribute('href', `/accounts/${ACC}/media/1790?from=2026-09-01&to=2026-09-30`);
    expect(screen.getByRole('link', { name: 'First page' })).toHaveAttribute('href', '?tab=comments&from=2026-09-01&to=2026-09-30');
  });

  it('filters become chips; Clear all keeps the section; a deep-linked older post shows as "This post"; Advanced holds Show only', () => {
    view(props({ q: 'cake', pr: '30d', media: '999', only: 'questions' }, { kind: 'comments', page: page([]), posts: POSTS }));
    const chips = screen.getByRole('list', { name: en.filters.active });
    expect(within(chips).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Search: cake', '?tab=comments&pr=30d&media=999&only=questions&from=2026-09-01&to=2026-09-30'],
      ['Commented: Last 30 days', '?tab=comments&q=cake&media=999&only=questions&from=2026-09-01&to=2026-09-30'],
      [T.postChip, '?tab=comments&pr=30d&q=cake&only=questions&from=2026-09-01&to=2026-09-30'],
      [T.onlyChip.questions, '?tab=comments&pr=30d&q=cake&media=999&from=2026-09-01&to=2026-09-30'],
    ]);
    expect(screen.getByRole('link', { name: en.filters.clearAll })).toHaveAttribute('href', '?tab=comments&from=2026-09-01&to=2026-09-30');
    expect(screen.getByRole('combobox', { name: T.post })).toHaveValue('999');
    expect(screen.getByRole('option', { name: T.thisPost })).toBeInTheDocument();
    expect(screen.getByText(T.emptySearch)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Advanced/ })).toBeInTheDocument();
  });

  it('no comments and no filters: "none yet" with when they arrive (never "no comments ever")', () => {
    view(props({}, { kind: 'comments', page: page([]), posts: [] }));
    expect(screen.getByText(T.empty)).toBeInTheDocument();
    expect(screen.getByText(T.emptyHint)).toBeInTheDocument();
  });

  it('choosing a view navigates with the filters kept and page 1', async () => {
    const user = userEvent.setup();
    view(props({ q: 'cake', page: '3' }, { kind: 'comments', page: page([comment(1)], 120, 3), posts: [] }));
    await user.click(screen.getByRole('tab', { name: 'Fans' }));
    expect(push).toHaveBeenLastCalledWith('?tab=comments&section=fans&q=cake&from=2026-09-01&to=2026-09-30', { scroll: false });
  });

  it('Unanswered questions: the rule and its limit on screen; no Show-only panel; renderActions fills each row (Plan 15d)', () => {
    const renderActions = vi.fn((c: CommentView) => <button type="button">{`Reply to ${c.id}`}</button>);
    view(props({ section: 'questions' }, { kind: 'comments', page: page([comment(1, { isQuestion: true })]), posts: [] }, { renderActions }));
    expect(screen.getByText(/^Rule-based: a question mark .* no later comment from @shop\.one/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advanced/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply to c1' })).toBeInTheDocument();
    expect(renderActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('Fans: the mode select, its rule with the numbers, the table, the people count', () => {
    view(props({ section: 'fans', fans: 'quiet' }, { kind: 'fans', page: page([{ username: 'amy', comments: 12, likes: 30, firstAt: '2026-08-01T00:00:00Z', lastAt: '2026-09-01T00:00:00Z', postsSince: 4 }], 1) }));
    expect(screen.getByRole('combobox', { name: T.fans.show })).toHaveValue('quiet');
    expect(screen.getByText('At least 3 comments, none in the last 30 days, while you published 3 or more posts since. A signal, not proof: they may still watch without commenting.')).toBeInTheDocument();
    expect(screen.getByText('1–1 of 1 people')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Username', 'Comments', 'Likes on their comments', 'First comment', 'Latest comment', 'Posts since']);
    expect(within(table).getByRole('link', { name: 'Open @amy on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/amy/');
    expect(within(table).getByText('2026-08-01')).toBeInTheDocument();
  });

  it('Topics: the basis with the sample, three lists; too few comments says how many are needed', () => {
    const { unmount } = view(
      props({ section: 'topics' }, { kind: 'topics', topics: { sample: 120, enough: true, words: [{ term: '颜色', comments: 5 }], emoji: [{ term: '😍', comments: 1 }], hashtags: [] } }),
    );
    expect(screen.getByText(/^From the newest 120 comments in this range/)).toBeInTheDocument();
    expect(screen.getByText('颜色')).toBeInTheDocument();
    expect(screen.getByText('in 5 comments')).toBeInTheDocument();
    expect(screen.getByText('in 1 comment')).toBeInTheDocument();
    expect(screen.getByText(T.topics.none)).toBeInTheDocument(); // no hashtags
    unmount();
    view(props({ section: 'topics' }, { kind: 'topics', topics: { sample: 7, enough: false, words: [], emoji: [], hashtags: [] } }));
    expect(screen.getByText('At least 20 comments are needed; this range has 7.')).toBeInTheDocument();
  });

  it('Not following you: snapshot-based basis line; without an export a link to the Followers tab', () => {
    const { unmount } = view(props({ section: 'outsiders' }, { kind: 'outsiders', page: page([{ username: 'bob', comments: 4, lastAt: '2026-10-01T00:00:00Z' }]), snapshot: { takenOn: '2026-10-20', followerCount: 1234 } }));
    expect(screen.getByText(/^Compared with your follower export of 2026-10-20 \(1,234 followers\)\. Snapshot-based/)).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('link', { name: 'Open @bob on Instagram' })).toHaveAttribute('href', 'https://www.instagram.com/bob/');
    unmount();
    view(props({ section: 'outsiders' }, { kind: 'noSnapshot' }));
    expect(screen.getByRole('link', { name: T.outsiders.openFollowers })).toHaveAttribute('href', '?tab=followers&from=2026-09-01&to=2026-09-30');
  });

  it('migration missing: the database-update note inside the view', () => {
    view(props({ section: 'fans' }, { kind: 'notReady' }));
    expect(screen.getByText(T.notReady)).toBeInTheDocument();
    expect(screen.getByText(T.notReadyHint)).toBeInTheDocument();
  });

  it('zh-CN', () => {
    view(props({}, { kind: 'comments', page: page([comment(1)]), posts: [] }), 'zh-CN');
    expect(screen.getAllByRole('tab').map((x) => x.textContent)).toEqual(['全部评论', '未回答的问题', '粉丝榜', '话题', '未关注你的人']);
    expect(screen.getByText('第 1–1 条，共 1 条评论')).toBeInTheDocument();
  });
});
