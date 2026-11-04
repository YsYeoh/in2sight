import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { OverviewView } from '@/components/overview/OverviewView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow, Post } from '@/lib/analysis/types';
import { buildOverview } from '@/lib/dashboard/overview';
import type { OverviewInput } from '@/lib/dashboard/read';
import { buildToday, todayFindings } from '@/lib/dashboard/today';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const B = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const TODAY = '2026-10-15';
const NOW = new Date('2026-10-15T04:00:00Z');
const KL = 'Asia/Kuala_Lumpur';
const o = { today: TODAY, now: NOW, tz: KL };
const acct = (id: string, username: string, x: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-01-01T00:00:00Z', ...x });
const days = (n: number, f: (day: string) => Partial<DailyRow> = () => ({})): DailyRow[] => Array.from({ length: n }, (_, i) => { const day = addDays(TODAY, i - n); return { day, followers: 1000 + i, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null, ...f(day) }; });
const post = (id: string, postedAt: string, reach: number, x: Partial<Post> = {}): Post => ({ id, accountId: A, mediaType: 'IMAGE', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null, ...x });
const synced = { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' };
const input: OverviewInput = {
  accounts: [acct(A, 'brand.one'), acct(B, 'broken', { status: 'needs_reconnect' })],
  sync: { [A]: synced, [B]: synced },
  daily: { [A]: days(60, (d) => (d === '2026-10-14' ? { reach: 500 } : {})), [B]: days(60) },
  posts: { [A]: [...Array.from({ length: 6 }, (_, i) => post(`h${i}`, `${addDays('2026-09-20', i)}T02:00:00Z`, 100)), post('hit', '2026-10-12T02:00:00Z', 900, { mediaType: 'REELS' })] },
};
const model = buildOverview(input, { scope: resolveScope(parseTimeScope(new URLSearchParams('from=7d')), TODAY, '2026-01-01'), today: TODAY, now: NOW, tz: KL, locale: 'en', weekStart: 'mon' });
const cards = model.sections.flatMap((s) => s.cards);
const briefing = buildToday(input, cards, todayFindings(input, cards, { [A]: 2, [B]: null }, o), [], o);
// 25 mature posts, every slot like the rest: enough posts, but no slot clearly ahead
const flat = Array.from({ length: 25 }, (_, i) => post(`f${i}`, `${addDays('2026-06-01', 3 * i)}T02:00:00Z`, 100));
const enough = { ...input, posts: { [A]: flat } };
const enoughBriefing = buildToday(enough, cards, todayFindings(enough, cards, {}, o), [], o);

function view(locale: 'en' | 'zh-CN' = 'en', b: typeof briefing | null = briefing) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <OverviewView model={model} today={TODAY} briefing={b ?? undefined} dismiss={vi.fn()} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Today on the Overview', () => {
  it('sits above the range bar, with the four answers', () => {
    view();
    const today = screen.getByRole('heading', { name: en.insights.today.title, level: 2 });
    const range = screen.getAllByRole('button').find((b) => /Last 7 Days|More ranges/.test(b.textContent ?? ''));
    expect(range && today.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const name of [en.insights.today.dayTitle, en.insights.today.attentionTitle, en.insights.today.workingTitle, en.insights.today.nextTitle]) expect(screen.getByRole('region', { name })).toBeInTheDocument();
  });

  it('latest day vs normal: the value, the typical one with n, and an Unusual badge', () => {
    view();
    const day = screen.getByRole('region', { name: en.insights.today.dayTitle });
    expect(within(day).getByText('@brand.one · 14 Oct 2026')).toBeInTheDocument();
    expect(within(day).getByText('Reach: 500')).toBeInTheDocument();
    expect(within(day).getByText('usually 100 (n = 8)')).toBeInTheDocument();
    expect(within(day).getAllByText(en.insights.today.unusual)).toHaveLength(1);
  });

  it('needs attention: the reconnect problem first, then the findings with the account name and dismiss buttons', () => {
    view();
    const att = screen.getByRole('region', { name: en.insights.today.attentionTitle });
    expect(within(att).getByRole('link', { name: '@broken needs to be reconnected' })).toHaveAttribute('href', '/accounts');
    expect(within(att).getByText(/2 questions in the last 7 days/)).toBeInTheDocument();
    expect(within(att).getAllByRole('button', { name: /^Dismiss: / }).length).toBeGreaterThan(0);
  });

  it('working now links to the Post Lab; next says when there are too few posts for a slot', () => {
    view();
    expect(within(screen.getByRole('region', { name: en.insights.today.workingTitle })).getByRole('link')).toHaveAttribute('href', `/accounts/${A}/media/hit`);
    const next = screen.getByRole('region', { name: en.insights.today.nextTitle });
    expect(within(next).getByText(/not enough posts yet for a slot suggestion/)).toBeInTheDocument();
    expect(within(next).getByText('Last post 3 days ago')).toBeInTheDocument();
  });

  it('next: with enough posts but no slot clearly ahead, it says that instead of "not enough posts" (both languages)', () => {
    view('en', enoughBriefing);
    const next = screen.getByRole('region', { name: en.insights.today.nextTitle });
    expect(within(next).getByText(en.insights.today.noSlotClear.replace('{username}', 'brand.one'))).toBeInTheDocument();
    expect(within(next).queryByText(/not enough posts/)).toBeNull();
    expect(en.insights.today.noSlotClear).not.toMatch(/high|20|certain|proven/i);
  });

  it('next (zh-CN): both reasons render their own Simplified Chinese text', () => {
    const { unmount } = view('zh-CN', enoughBriefing);
    expect(screen.getByText(zh.insights.today.noSlotClear.replace('{username}', 'brand.one'))).toBeInTheDocument();
    unmount();
    view('zh-CN');
    expect(screen.getByText(zh.insights.today.noSlotFew.replace('{username}', 'brand.one'))).toBeInTheDocument();
  });

  it('no briefing (no accounts or an old caller): no Today section; zh-CN renders cleanly', () => {
    const { unmount } = view('en', null);
    expect(screen.queryByRole('heading', { name: en.insights.today.title })).toBeNull();
    unmount();
    const { container } = view('zh-CN');
    expect(screen.getByRole('heading', { name: zh.insights.today.title, level: 2 })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|undefined|insights\./);
  });
});
