import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, PREFS_COOKIE, parsePrefsCookie, serializePrefs } from '@/lib/prefs';

const jar = { get: vi.fn(), set: vi.fn() };
const revalidatePath = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
const persistPrefsToProfile = vi.fn<(prefs: unknown, keys: unknown) => Promise<void>>();
vi.mock('@/lib/prefs.sync.server', () => ({ persistPrefsToProfile: (p: unknown, k: unknown) => persistPrefsToProfile(p, k), syncPrefsFromProfile: vi.fn() }));

import { setPrefs } from '@/app/actions';

/** The value setPrefs last wrote, parsed back through the real cookie parser. */
const written = () => parsePrefsCookie(jar.set.mock.calls.at(-1)![1]);

beforeEach(() => {
  jar.get.mockReset().mockReturnValue(undefined);
  jar.set.mockReset();
  revalidatePath.mockReset();
  persistPrefsToProfile.mockReset().mockResolvedValue(undefined);
});

describe('setPrefs', () => {
  it('merges a valid partial onto the existing cookie and writes it with the expected options', async () => {
    jar.get.mockReturnValue({ value: serializePrefs({ ...DEFAULT_PREFS, theme: 'forest', locale: 'zh-CN' }) });
    await setPrefs({ mode: 'dark' });
    expect(jar.get).toHaveBeenCalledWith(PREFS_COOKIE);
    expect(jar.set).toHaveBeenCalledTimes(1);
    expect(jar.set.mock.calls[0][0]).toBe(PREFS_COOKIE);
    expect(jar.set.mock.calls[0][2]).toEqual({ path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
    expect(written()).toEqual({ ...DEFAULT_PREFS, theme: 'forest', locale: 'zh-CN', mode: 'dark' });
  });

  it.each([[null], [42], ['x'], [[]], [[{ theme: 'mono' }]]])('never throws on junk input %j and writes defaults', async (junk) => {
    await expect(setPrefs(junk)).resolves.toBeUndefined();
    expect(written()).toEqual(DEFAULT_PREFS);
  });

  it('drops an invalid field but still applies the valid ones', async () => {
    await setPrefs({ theme: 'bogus', mode: 'dark' });
    expect(written()).toEqual({ ...DEFAULT_PREFS, mode: 'dark' });
  });

  it('revalidates the root layout', async () => {
    await setPrefs({ mode: 'dark' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('treats a tampered existing cookie as defaults before merging', async () => {
    jar.get.mockReturnValue({ value: '%E0%A4%A' });
    await setPrefs({ density: 'comfortable' });
    expect(written()).toEqual({ ...DEFAULT_PREFS, density: 'comfortable' });
  });

  it('persists the merged prefs to the profile after the cookie is written, before revalidating', async () => {
    const order: string[] = [];
    jar.set.mockImplementation(() => order.push('cookie'));
    persistPrefsToProfile.mockImplementation(async () => void order.push('profile'));
    revalidatePath.mockImplementation(() => order.push('revalidate'));
    await setPrefs({ mode: 'dark', weekStart: 'sun' });
    expect(persistPrefsToProfile).toHaveBeenCalledWith({ ...DEFAULT_PREFS, mode: 'dark', weekStart: 'sun' }, ['mode', 'weekStart']);
    expect(order).toEqual(['cookie', 'profile', 'revalidate']);
  });

  it('still resolves, and still revalidates, when the profile write rejects', async () => {
    persistPrefsToProfile.mockRejectedValue(new Error('db down'));
    await expect(setPrefs({ mode: 'dark' })).resolves.toBeUndefined();
    expect(written().mode).toBe('dark');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('persists only the keys the patch named, never unknown ones', async () => {
    await setPrefs({ theme: 'mono', bogus: 1 });
    expect(persistPrefsToProfile).toHaveBeenCalledWith(expect.objectContaining({ theme: 'mono' }), ['theme']);
  });
});
