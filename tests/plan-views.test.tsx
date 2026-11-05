import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const push = vi.fn();
const refresh = vi.fn();
let pathname = '/plan/digest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }), usePathname: () => pathname }));

import { DigestView } from '@/components/plan/DigestView';
import { GoalsView, type SaveGoals } from '@/components/plan/GoalsView';
import { PlanNav } from '@/components/plan/PlanNav';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { Finding } from '@/lib/analysis/insights';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { StoredAccount } from '@/lib/accounts/types';
import type { OverviewInput } from '@/lib/dashboard/read';
import { buildDigest, buildGoals, parseDigestPeriod } from '@/lib/plan/model';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const today = '2026-10-29';
const now = new Date('2026-10-29T10:00:00Z');
const o = { today, now, tz: 'UTC', locale: 'en', weekStart: 'mon' as const };
const acct: StoredAccount = { id: A, igUserId: '1', username: 'one', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-08-01T00:00:00Z' };
const day = (d: string): DailyRow => ({ day: d, followers: 1000, reach: 100, views: 200, accountsEngaged: null, interactions: 10, follows: null, unfollows: null, linkTaps: null });
const post = (id: string, postedAt: string, reach: number): Post => ({ id, accountId: A, mediaType: 'REELS', postedAt, permalink: null, reach, views: null, likes: null, comments: null, shares: null, saves: null });
const input: OverviewInput = { accounts: [acct], sync: {}, daily: { [A]: Array.from({ length: 40 }, (_, i) => day(addDays('2026-09-19', i))) }, posts: { [A]: [post('p1', '2026-10-20T03:00:00Z', 500), post('p2', '2026-10-22T03:00:00Z', 900)] } };

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <PrefsProvider initial={{ ...DEFAULT_PREFS, timezone: 'UTC' }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
const G = en.plan.goals;
const D = en.plan.digest;

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
  pathname = '/plan/digest';
});

describe('PlanNav', () => {
  it('underline tabs Digest and Goals; the current path is selected; choosing one navigates to /plan/<id>', async () => {
    wrap(<PlanNav />);
    const list = screen.getByRole('tablist', { name: en.plan.sections.label });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Digest', 'Goals', 'Board']);
    expect(screen.getByRole('tab', { name: 'Digest' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Goals' }));
    expect(push).toHaveBeenCalledWith('/plan/goals');
  });
});

describe('DigestView', () => {
  const model = buildDigest(input, [], { ...o, period: parseDigestPeriod({}, today, 'mon') });

  it('states the period, its source, the KPIs with a comparison, and the best posts linking to the Post Lab', () => {
    wrap(<DigestView model={model} today={today} goalsReady />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/to/);
    expect(screen.getByText(D.source)).toBeInTheDocument();
    expect(screen.getAllByText('Reach').length).toBeGreaterThan(0);
    const best = screen.getByRole('heading', { name: D.topTitle }).parentElement!;
    expect(within(best).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([`/accounts/${A}/media/p2`, `/accounts/${A}/media/p1`]);
    expect(screen.getByText(D.bottomFew.replace('{n}', '7'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: D.setGoals })).toHaveAttribute('href', '/plan/goals');
  });

  it('Previous / Next are links; Next is disabled on the newest period; Month navigates to the last complete month', async () => {
    wrap(<DigestView model={buildDigest(input, [], { ...o, period: parseDigestPeriod({ week: today }, today, 'mon') })} today={today} goalsReady={false} />);
    expect(screen.getByRole('link', { name: D.previous })).toHaveAttribute('href', '/plan/digest?week=2026-10-19');
    expect(screen.getByRole('button', { name: D.next })).toBeDisabled();
    expect(screen.getByText(D.running)).toBeInTheDocument();
    expect(screen.queryByText(D.goalsTitle)).toBeNull(); // no goals block before the migration
    await userEvent.click(screen.getByRole('button', { name: D.month }));
    expect(push).toHaveBeenCalledWith('/plan/digest?month=2026-09');
  });
});

describe('DigestView findings (Plan 17b feed, now)', () => {
  const f = (id: string): Finding => ({ key: `breakout:${A}:${id}`, accountId: A, kind: 'breakout', tone: 'good', params: { ratio: 3, format: 'REELS' }, n: 20, confidence: 'low', day: '2026-10-22', postId: id, href: `/accounts/${A}/media/${id}` });
  const model = () => buildDigest(input, [], { ...o, period: parseDigestPeriod({}, today, 'mon') });

  it('no findings prop: no findings block', () => {
    wrap(<DigestView model={model()} today={today} goalsReady={false} />);
    expect(screen.queryByText(D.findingsTitle)).toBeNull();
  });

  it('shows the first three, links to the rest on the account page, and dismisses through the Overview action', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn().mockResolvedValue({ ok: true });
    const items = ['a', 'b', 'c', 'd'].map(f);
    wrap(<DigestView model={model()} today={today} goalsReady={false} findings={{ byAccount: { [A]: items }, canDismiss: true }} dismiss={dismiss} />);
    expect(screen.getByText(D.findingsTitle)).toBeInTheDocument();
    expect(screen.getAllByText(en.insights.dismiss)).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Show all (4)' })).toHaveAttribute('href', `/accounts/${A}?findings=all`);
    await user.click(screen.getAllByText(en.insights.dismiss)[0]);
    expect(dismiss).toHaveBeenCalledWith(items[0].key, 'dismiss');
  });

  it('an account without findings says so', () => {
    wrap(<DigestView model={model()} today={today} goalsReady={false} findings={{ byAccount: { [A]: [] }, canDismiss: true }} dismiss={vi.fn()} />);
    expect(screen.getByText(en.insights.empty)).toBeInTheDocument();
  });

  it('without the dismissals table: no buttons and the "needs a database update" hint', () => {
    wrap(<DigestView model={model()} today={today} goalsReady={false} findings={{ byAccount: { [A]: [f('a')] }, canDismiss: false }} />);
    expect(screen.queryByText(en.insights.dismiss)).toBeNull();
    expect(screen.getByText(en.insights.needsUpdate)).toBeInTheDocument();
  });
});

describe('GoalsView', () => {
  const save = vi.fn<SaveGoals>();
  beforeEach(() => save.mockReset().mockResolvedValue({ ok: true }));

  it('without the migration: one "needs a database update" message and no form', () => {
    wrap(<GoalsView accounts={buildGoals(input, [], o)} ready={false} today={today} save={save} />);
    expect(screen.getByText(G.needsUpdate)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('explicit save: Save is off while clean; a typed goal saves the raw values and refreshes the page', async () => {
    const user = userEvent.setup();
    wrap(<GoalsView accounts={buildGoals(input, [], o)} ready today={today} save={save} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText(G.postsPerWeek), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(A, { followers: '', followersDue: '', avg_reach: '', posts_per_week: '3' });
    expect(await screen.findByRole('status')).toHaveTextContent(G.saved);
    expect(refresh).toHaveBeenCalled();
  });

  it('an invalid value is named before anything is sent; a server error key is shown as text', async () => {
    const user = userEvent.setup();
    wrap(<GoalsView accounts={buildGoals(input, [], o)} ready today={today} save={save} />);
    await user.type(screen.getByLabelText(G.followers), '5000'); // no due day
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(G.errors.invalid);
    await user.clear(screen.getByLabelText(G.followers));
    await user.type(screen.getByLabelText(G.avgReach), '800');
    save.mockResolvedValueOnce({ ok: false, error: 'needs_update' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(G.errors.needs_update);
  });

  it('a followers goal that is due today does not block the other goals; changing it asks for a new day', async () => {
    const user = userEvent.setup();
    const goals = [{ id: 'g', accountId: A, metric: 'followers' as const, target: 5000, dueDay: today, startDay: '2026-10-01' }];
    wrap(<GoalsView accounts={buildGoals(input, goals, o)} ready today={today} save={save} />);
    await user.type(screen.getByLabelText(G.postsPerWeek), '3');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(A, { followers: '5000', followersDue: today, avg_reach: '', posts_per_week: '3' });
    save.mockClear();
    await user.type(screen.getByLabelText(G.followers), '0'); // 50000 with the same, passed, day
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(G.errors.invalid);
  });

  it('stored goals fill the form and their progress shows with a status word', () => {
    const goals = [{ id: 'g', accountId: A, metric: 'posts_per_week' as const, target: 2, dueDay: null, startDay: '2026-10-01' }];
    wrap(<GoalsView accounts={buildGoals(input, goals, o)} ready today={today} save={save} />);
    expect(screen.getByLabelText(G.postsPerWeek)).toHaveValue(2);
    expect(within(screen.getByRole('list', { name: 'Goals of @one' })).getByText(G.status.behind)).toBeInTheDocument();
  });
});
