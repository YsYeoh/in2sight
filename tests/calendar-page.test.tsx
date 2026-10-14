import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonthModel } from '@/lib/dashboard/calendar';

const { calls, accounts } = vi.hoisted(() => ({ calls: [] as unknown[][], accounts: [] as Record<string, unknown>[] }));
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => void calls.push(['requireOwner']) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), {}) }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => ({ ...(await import('@/lib/prefs')).DEFAULT_PREFS, timezone: 'Asia/Kuala_Lumpur', weekStart: 'mon' }) }));
vi.mock('@/lib/accounts/supabase-store', () => ({ supabaseAccountsStore: () => ({ list: async () => accounts }) }));
const read = vi.hoisted(() => ({ truncated: false }));
vi.mock('@/lib/dashboard/detail-read', () => ({ loadMonthMedia: async (...a: unknown[]) => (calls.push(['month', ...a.slice(1)]), { media: [], truncated: read.truncated }) }));

import CalendarPage from '@/app/(app)/calendar/page';

const A1 = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const A2 = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const acct = (id: string, status = 'active') => ({ id, username: id.slice(0, 4), status });
const run = (sp: Record<string, string | string[]>) => CalendarPage({ searchParams: Promise.resolve(sp) }) as Promise<ReactElement<{ model: MonthModel; account: string | null; accounts: { id: string }[]; truncated: boolean }>>;

beforeEach(() => {
  calls.length = 0;
  accounts.length = 0;
  read.truncated = false;
  accounts.push(acct(A1), acct(A2), acct('9e9e9e9e-0000-4000-8000-000000000000', 'archived'));
});

describe('calendar page', () => {
  it('requireOwner first; a month in the owner timezone over every live account', async () => {
    const el = await run({ month: '2026-10' });
    expect(calls[0]).toEqual(['requireOwner']);
    expect(el.props.model.month).toBe('2026-10');
    expect(el.props.account).toBeNull();
    expect(el.props.accounts.map((a) => a.id)).toEqual([A1, A2]); // archived hidden
    expect(calls.find((c) => c[0] === 'month')).toEqual(['month', [A1, A2], '2026-09-27T16:00:00.000Z', '2026-11-01T16:00:00.000Z']);
  });

  it('a valid account filter narrows the read; junk, unknown or archived ids fall back to all accounts', async () => {
    expect((await run({ account: A2.toUpperCase(), month: '2026-10' })).props.account).toBe(A2);
    expect(calls.find((c) => c[0] === 'month')?.[1]).toEqual([A2]);
    for (const bad of ['x', '9e9e9e9e-0000-4000-8000-000000000000', [A1, A2]]) expect((await run({ account: bad })).props.account).toBeNull();
  });

  it('keys the view by month and account so the selected day resets when either changes', async () => {
    expect((await run({ month: '2026-10' })).key).toBe('2026-10|');
    expect((await run({ month: '2026-11' })).key).toBe('2026-11|');
    expect((await run({ month: '2026-10', account: A1 })).key).toBe(`2026-10|${A1}`);
  });

  it('passes the truncation flag from the read', async () => {
    expect((await run({ month: '2026-10' })).props.truncated).toBe(false);
    read.truncated = true;
    expect((await run({ month: '2026-10' })).props.truncated).toBe(true);
  });

  it('a junk month falls back to the current month', async () => {
    expect((await run({ month: '2026-13' })).props.model.month).toMatch(/^\d{4}-\d{2}$/);
  });
});
