import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, PREFS_COOKIE, parsePrefsCookie, serializePrefs } from '@/lib/prefs';
import { prefsToProfileRow } from '@/lib/prefs.sync';

const jar = { get: vi.fn(), set: vi.fn() };
const session = { signedIn: true, userId: 'u1', email: 'a@b.c', aal: 'aal1', mfaRequired: false };
const getSessionInfo = vi.fn();
const configured = vi.fn();
const createServerSupabase = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('@/lib/auth/session', () => ({ getSessionInfo: (...a: unknown[]) => getSessionInfo(...a) }));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: () => configured() }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: () => createServerSupabase() }));

import { persistPrefsToProfile, syncPrefsFromProfile } from '@/lib/prefs.sync.server';

const custom = { ...DEFAULT_PREFS, theme: 'forest' as const, weekStart: 'sun' as const, timezone: 'Europe/London' };

/** A user-session client fake: records the table, the user filter and every upsert. */
function fakeClient(opts: { row?: unknown; readError?: boolean; readErrorResult?: boolean; writeError?: boolean } = {}) {
  const upserts: unknown[] = [];
  const filters: [string, unknown][] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe('profiles');
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            filters.push([col, val]);
            return {
              maybeSingle: async () => {
                if (opts.readError) throw new Error('boom secret-token');
                if (opts.readErrorResult) return { data: null, error: { message: 'permission denied' } };
                return { data: opts.row ?? null, error: null };
              },
            };
          },
        }),
        upsert: async (row: unknown) => {
          if (opts.writeError) throw new Error('boom secret-token');
          upserts.push(row);
          return { error: null };
        },
      };
    },
  };
  return { client: client as never, upserts, filters };
}

const cookieWritten = () => parsePrefsCookie(jar.set.mock.calls.at(-1)![1]);

beforeEach(() => {
  jar.get.mockReset().mockReturnValue(undefined);
  jar.set.mockReset();
  getSessionInfo.mockReset().mockResolvedValue(session);
  configured.mockReset().mockReturnValue(true);
  createServerSupabase.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('syncPrefsFromProfile', () => {
  it('the saved profile wins: it is written to the preferences cookie and nothing is upserted', async () => {
    const { client, upserts, filters } = fakeClient({ row: prefsToProfileRow('u1', custom) });
    jar.get.mockReturnValue({ value: serializePrefs({ ...DEFAULT_PREFS, theme: 'mono' }) });
    await syncPrefsFromProfile(client);
    expect(filters).toEqual([['user_id', 'u1']]);
    expect(jar.set.mock.calls[0][0]).toBe(PREFS_COOKIE);
    expect(cookieWritten()).toEqual(custom);
    expect(upserts).toEqual([]);
  });

  it('no profile yet: creates one from the current cookie and leaves the cookie alone', async () => {
    const { client, upserts } = fakeClient();
    jar.get.mockReturnValue({ value: serializePrefs(custom) });
    await syncPrefsFromProfile(client);
    expect(upserts).toEqual([prefsToProfileRow('u1', custom)]);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('a read that returns an error is not treated as "no profile": the saved profile is never overwritten', async () => {
    const { client, upserts } = fakeClient({ readErrorResult: true });
    await syncPrefsFromProfile(client);
    expect(upserts).toEqual([]);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('does nothing when signed out', async () => {
    getSessionInfo.mockResolvedValue({ ...session, signedIn: false, userId: null });
    const { client, upserts } = fakeClient();
    await syncPrefsFromProfile(client);
    expect(upserts).toEqual([]);
    expect(jar.set).not.toHaveBeenCalled();
  });

  it('swallows read and write failures and never logs the error content', async () => {
    await expect(syncPrefsFromProfile(fakeClient({ readError: true }).client)).resolves.toBeUndefined();
    await expect(syncPrefsFromProfile(fakeClient({ writeError: true }).client)).resolves.toBeUndefined();
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('secret-token');
  });
});

describe('persistPrefsToProfile', () => {
  it('upserts the row for the signed-in user through the user-session client, stamping updated_at', async () => {
    const f = fakeClient();
    createServerSupabase.mockResolvedValue(f.client);
    await persistPrefsToProfile(custom, ['theme']);
    expect(f.upserts).toHaveLength(1);
    expect(Object.keys(f.upserts[0] as object).sort()).toEqual(['theme', 'updated_at', 'user_id']);
    expect(f.upserts[0]).toMatchObject({ user_id: 'u1', theme: 'forest' });
    expect((f.upserts[0] as { updated_at: string }).updated_at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('never sends columns that were not patched (a stale cookie cannot clobber them)', async () => {
    const f = fakeClient();
    createServerSupabase.mockResolvedValue(f.client);
    await persistPrefsToProfile(custom, ['density', 'timezone']);
    const row = f.upserts[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['density', 'timezone', 'updated_at', 'user_id']);
  });

  it('writes nothing when the patch had no preference keys', async () => {
    const f = fakeClient();
    createServerSupabase.mockResolvedValue(f.client);
    await persistPrefsToProfile(custom, []);
    expect(f.upserts).toEqual([]);
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('is a no-op when Supabase is not configured (no client is even created)', async () => {
    configured.mockReturnValue(false);
    await persistPrefsToProfile(custom, ['theme']);
    expect(createServerSupabase).not.toHaveBeenCalled();
  });

  it('is a no-op without a session', async () => {
    const f = fakeClient();
    createServerSupabase.mockResolvedValue(f.client);
    getSessionInfo.mockResolvedValue({ ...session, signedIn: false, userId: null });
    await persistPrefsToProfile(custom, ['theme']);
    expect(f.upserts).toEqual([]);
  });

  it('never throws, even if the client cannot be created or the write fails', async () => {
    createServerSupabase.mockRejectedValue(new Error('no env'));
    await expect(persistPrefsToProfile(custom, ['theme'])).resolves.toBeUndefined();
    createServerSupabase.mockResolvedValue(fakeClient({ writeError: true }).client);
    await expect(persistPrefsToProfile(custom, ['theme'])).resolves.toBeUndefined();
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('secret-token');
  });
});
