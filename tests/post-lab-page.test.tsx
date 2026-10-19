import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LabInput, LabItem } from '@/lib/analysis/post-lab';
import type { PostLabRead } from '@/lib/post-lab/read';

const { calls, accounts, read } = vi.hoisted(() => ({ calls: [] as unknown[][], accounts: [] as Record<string, unknown>[], read: { value: null as unknown } }));

vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => void calls.push(['requireOwner']) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => (calls.push(['session']), { db: true }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => calls.push(['ADMIN']) }));
vi.mock('@/lib/prefs.server', async () => ({ getPrefs: async () => (await import('@/lib/prefs')).DEFAULT_PREFS }));
vi.mock('@/lib/dashboard/cached', () => ({ loadAccounts: async () => (calls.push(['accounts']), accounts) }));
vi.mock('@/lib/dashboard/detail-read', () => ({ loadTags: async () => (calls.push(['tags']), [{ id: 't1', name: 'Promo', color: 'chart-1' }]) }));
vi.mock('@/lib/post-lab/read', () => ({ loadPostLab: async (...a: unknown[]) => (calls.push(['read', ...a.slice(1)]), read.value) }));

import PostLabPage from '@/app/(app)/accounts/[id]/media/[mediaId]/page';
import { PostLabUnavailable, PostLabView } from '@/components/post-lab/PostLabView';
import { DEFAULT_PREFS } from '@/lib/prefs';

const ID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const acct = (status = 'active') => ({ id: ID, igUserId: 'ig', username: 'brand', displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status, archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-09-01T00:00:00Z' });
const ITEM: LabItem = { id: '178', accountId: ID, mediaType: 'IMAGE', postedAt: '2026-10-01T02:00:00Z', expiresAt: null, goneAt: null, permalink: null, caption: 'Hi', tagIds: [], cover: 'ok', slides: null, measuredAt: null, latest: null, points: {} };
const OK: PostLabRead = { kind: 'ok', input: { item: ITEM, peers: [], day: [], followers: {} } satisfies LabInput };
const run = (id: string, mediaId: string, sp: Record<string, string | string[]> = {}) => PostLabPage({ params: Promise.resolve({ id, mediaId }), searchParams: Promise.resolve(sp) }) as Promise<ReactElement<Record<string, unknown>>>;

beforeEach(() => {
  calls.length = 0;
  accounts.length = 0;
  read.value = OK;
});

describe('Post Lab page', () => {
  it('bad ids → notFound after requireOwner and before any database client', async () => {
    await expect(run('not-a-uuid', '178')).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(run(ID, "178'--")).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(run(ID, '../x')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(calls).toEqual([['requireOwner'], ['requireOwner'], ['requireOwner']]);
  });

  it('unknown or archived account, or a media id that is not this account’s → notFound', async () => {
    await expect(run(ID, '178')).rejects.toThrow('NEXT_NOT_FOUND');
    accounts.push(acct('archived'));
    await expect(run(ID, '178')).rejects.toThrow('NEXT_NOT_FOUND');
    accounts.length = 0;
    accounts.push(acct());
    read.value = { kind: 'not_found' };
    await expect(run(ID, '999')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(calls).toContainEqual(['read', ID, '999', DEFAULT_PREFS.timezone]);
    expect(calls.some((c) => c[0] === 'ADMIN')).toBe(false);
  });

  it('missing migration → the "needs a database update" state, not a crash', async () => {
    accounts.push(acct());
    read.value = { kind: 'needs_migration' };
    const el = await run(ID, '178', { from: '90d' });
    expect(el.type).toBe(PostLabUnavailable);
    expect(el.props.back).toBe(`/accounts/${ID}?tab=posts&from=90d`);
  });

  it('wires the model, the toggles and the carried scope into the view; the owner session reads (upper-case id is fine)', async () => {
    accounts.push(acct());
    const el = await run(ID.toUpperCase(), '178', { peers: '90', er: 'followers', from: '1y', junk: 'x' });
    expect(calls[0]).toEqual(['requireOwner']);
    expect(el.type).toBe(PostLabView);
    expect(el.props.params).toEqual({ peers: 90, er: 'followers', scope: { from: '1y' } });
    expect(el.props.account).toEqual({ id: ID, username: 'brand' });
    expect(el.props.tags).toEqual([{ id: 't1', name: 'Promo', color: 'chart-1' }]);
    expect((el.props.model as { peers: unknown }).peers).toEqual({ asked: 90, used: 0, read: 0 });
    expect(typeof el.props.setPostTags).toBe('function');
  });
});
