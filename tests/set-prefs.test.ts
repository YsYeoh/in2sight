import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, PREFS_COOKIE, parsePrefsCookie, serializePrefs } from '@/lib/prefs';

const jar = { get: vi.fn(), set: vi.fn() };
const revalidatePath = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => jar }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

import { setPrefs } from '@/app/actions';

/** The value setPrefs last wrote, parsed back through the real cookie parser. */
const written = () => parsePrefsCookie(jar.set.mock.calls.at(-1)![1]);

beforeEach(() => {
  jar.get.mockReset().mockReturnValue(undefined);
  jar.set.mockReset();
  revalidatePath.mockReset();
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
});
