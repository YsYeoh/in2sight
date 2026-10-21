import { describe, expect, it } from 'vitest';
import { checkFiles, cleanTimestamp, cleanUsername, MAX_FILE_BYTES, MAX_FOLLOWERS, MAX_FOLLOWING, parseExportFiles, type Parsed } from '@/lib/followers/parse';

const NOW = 1_793_000_000; // 2026-10-26
const T1 = 1_700_000_000;
const T2 = 1_710_000_000;
/** One entry the way followers_1.json writes it (E3). */
const entry = (name: string, ts: unknown = T1) => ({ title: '', media_list_data: [], string_list_data: [{ href: `https://www.instagram.com/${name}`, value: name, timestamp: ts }] });
/** One entry the way newer following.json files write it: name in title, no value, /_u/ links (E4). */
const titled = (name: string, ts: unknown = T2) => ({ title: name, string_list_data: [{ href: `https://www.instagram.com/_u/${name}`, timestamp: ts }] });
const file = (name: string, json: unknown) => ({ name, text: JSON.stringify(json, null, 2) });
const ok = (r: ReturnType<typeof parseExportFiles>): Parsed => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r as Parsed;
};

describe('checkFiles (before any byte is read)', () => {
  it('accepts up to 10 .json files of at most 32 MB each and 64 MB together', () => {
    expect(checkFiles([{ name: 'followers_1.json', size: 10 }, { name: 'C:\\fakepath\\FOLLOWING.JSON', size: 10 }])).toBeNull();
    expect(checkFiles([{ name: 'followers_1.json', size: MAX_FILE_BYTES }])).toBeNull();
  });

  it('names the problem with a key (and the file where there is one)', () => {
    expect(checkFiles([])).toEqual({ ok: false, error: 'noFiles' });
    expect(checkFiles(Array.from({ length: 11 }, (_, i) => ({ name: `followers_${i}.json`, size: 1 })))).toEqual({ ok: false, error: 'tooManyFiles' });
    expect(checkFiles([{ name: 'instagram-me-2026.zip', size: 1 }])).toEqual({ ok: false, error: 'zipNotSupported', file: 'instagram-me-2026.zip' });
    expect(checkFiles([{ name: 'followers_1.html', size: 1 }])).toEqual({ ok: false, error: 'htmlFormat', file: 'followers_1.html' });
    expect(checkFiles([{ name: 'followers.txt', size: 1 }])).toEqual({ ok: false, error: 'notJson', file: 'followers.txt' });
    expect(checkFiles([{ name: 'followers', size: 1 }])).toEqual({ ok: false, error: 'notJson', file: 'followers' });
    expect(checkFiles([{ name: '/tmp/followers_1.json', size: MAX_FILE_BYTES + 1 }])).toEqual({ ok: false, error: 'fileTooLarge', file: 'followers_1.json' });
    expect(checkFiles([1, 2, 3].map((i) => ({ name: `followers_${i}.json`, size: 30 * 1024 * 1024 })))).toEqual({ ok: false, error: 'totalTooLarge' });
  });
});

describe('cleanUsername / cleanTimestamp', () => {
  it('usernames: trimmed, no leading @, lower-cased, Instagram alphabet, at most 30 characters', () => {
    expect(['  @Some.User_1 ', 'abc', 'a'.repeat(30), '__proto__'].map(cleanUsername)).toEqual(['some.user_1', 'abc', 'a'.repeat(30), '__proto__']);
    for (const bad of ['', '@', 'a'.repeat(31), 'with space', 'ümlaut', 'a/b', '<script>', '名字', 42, null, undefined, {}]) expect(cleanUsername(bad), String(bad)).toBeNull();
  });

  it('timestamps: whole seconds from 2010-01-01 to one day after now, else unknown', () => {
    expect(cleanTimestamp(T1, NOW)).toBe(T1);
    expect(cleanTimestamp(NOW + 86_400, NOW)).toBe(NOW + 86_400);
    for (const bad of [NOW + 86_401, 1_262_303_999, 1.5e9 + 0.5, '1700000000', -1, null, T1 * 1000]) expect(cleanTimestamp(bad, NOW), String(bad)).toBeNull();
  });
});

describe('parseExportFiles: the accepted variants', () => {
  it('followers_1.json as a bare array (E3): value, timestamp; names lower-cased', () => {
    const r = ok(parseExportFiles([file('followers_1.json', [entry('alice'), entry('Bob.B', T2)])], NOW));
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }, { username: 'bob.b', at: T2 }]);
    expect(r.following).toBeNull();
    expect(r).toMatchObject({ skipped: 0, ignored: [] });
  });

  it('the wrapped form {relationships_followers: [...]} and following.json {relationships_following: [...]}', () => {
    const r = ok(parseExportFiles([file('anything.json', { relationships_followers: [entry('alice')] }), file('following.json', { relationships_following: [entry('carol', T2)] })], NOW));
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }]);
    expect(r.following).toEqual([{ username: 'carol', at: T2 }]);
  });

  it('newer following.json (E4): the name only in title, /_u/ links; a bare following.json array works too', () => {
    const r = ok(parseExportFiles([file('followers_1.json', [entry('alice')]), file('following.json', { relationships_following: [titled('dave'), titled('Eve')] })], NOW));
    expect(r.following).toEqual([{ username: 'dave', at: T2 }, { username: 'eve', at: T2 }]);
    const bare = ok(parseExportFiles([file('followers_1.json', []), file('following.json', [titled('dave')])], NOW));
    expect(bare.following).toEqual([{ username: 'dave', at: T2 }]);
  });

  it('the href is the last resort for the name (with or without /_u/, trailing slash, query)', () => {
    const viaHref = (href: string) => ({ title: '', string_list_data: [{ href, timestamp: T1 }] });
    const r = ok(parseExportFiles([file('followers_1.json', [viaHref('https://www.instagram.com/frank'), viaHref('https://instagram.com/_u/Gina/'), viaHref('https://www.instagram.com/hank?igsh=x'), viaHref('https://evil.example/ivan')])], NOW));
    expect(r.followers.map((p) => p.username)).toEqual(['frank', 'gina', 'hank']);
    expect(r.skipped).toBe(1);
  });

  it('followers split over followers_1.json, followers_2.json … are merged; a duplicate keeps the first entry and fills a missing time', () => {
    const r = ok(parseExportFiles([file('followers_1.json', [entry('alice'), entry('bob', 'x')]), file('followers_2.json', [entry('bob', T2), entry('alice', T2), entry('carl')])], NOW));
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }, { username: 'bob', at: T2 }, { username: 'carl', at: T1 }]);
  });

  it('odd entries are skipped and counted, never an error; unknown fields are ignored; a BOM is fine', () => {
    const odd = [null, 42, 'alice', [], {}, { string_list_data: 'x' }, { string_list_data: [null] }, entry('bad name'), entry('a'.repeat(31)), { ...entry('ok.name', 'not a number'), extra: { deep: [1, 2] } }];
    const r = ok(parseExportFiles([{ name: 'followers_1.json', text: `\uFEFF${JSON.stringify(odd)}` }], NOW));
    expect(r.followers).toEqual([{ username: 'ok.name', at: null }]);
    expect(r.skipped).toBe(9);
  });

  it('other files of the export folder are recognised and skipped, not stored (recently unfollowed, pending requests …)', () => {
    const r = ok(
      parseExportFiles(
        [file('followers_1.json', [entry('alice')]), file('recently_unfollowed_profiles.json', { relationships_unfollowed_users: [entry('zed')] }), file('pending_follow_requests.json', { relationships_follow_requests_sent: [entry('yan')] })],
        NOW,
      ),
    );
    expect(r.followers).toEqual([{ username: 'alice', at: T1 }]);
    expect(r.following).toBeNull();
    expect(r.ignored).toEqual(['recently_unfollowed_profiles.json', 'pending_follow_requests.json']);
  });

  it('names are plain data: "__proto__" is an ordinary follower and nothing is polluted', () => {
    const r = ok(parseExportFiles([{ name: 'followers_1.json', text: '[{"string_list_data":[{"value":"__proto__","timestamp":1700000000}]},{"__proto__":{"polluted":1},"title":"x"}]' }], NOW));
    expect(r.followers).toEqual([{ username: '__proto__', at: T1 }, { username: 'x', at: null }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('parseExportFiles: rejected input (error key + file)', () => {
  const err = (files: { name: string; text: string }[]) => parseExportFiles(files, NOW);

  it('HTML exports, broken JSON and other shapes', () => {
    expect(err([{ name: 'followers_1.json', text: ' <html><body>followers</body></html>' }])).toEqual({ ok: false, error: 'htmlFormat', file: 'followers_1.json' });
    expect(err([{ name: 'followers_1.json', text: '[{"string_list_data": [' }])).toEqual({ ok: false, error: 'badJson', file: 'followers_1.json' });
    expect(err([file('close_friends.json', [entry('alice')])])).toEqual({ ok: false, error: 'unknownFile', file: 'close_friends.json' });
    expect(err([file('followers_1.json', { data: [entry('alice')] })])).toEqual({ ok: false, error: 'unknownFile', file: 'followers_1.json' });
    expect(err([file('followers_1.json', {})])).toEqual({ ok: false, error: 'unknownFile', file: 'followers_1.json' });
    expect(err([file('followers_1.json', { relationships_followers: { alice: 1 } })])).toEqual({ ok: false, error: 'badShape', file: 'followers_1.json' });
    expect(err([file('followers_1.json', 42)])).toEqual({ ok: false, error: 'badShape', file: 'followers_1.json' });
    expect(err([file('followers_1.json', null)])).toEqual({ ok: false, error: 'badShape', file: 'followers_1.json' });
  });

  it('the comparison needs a followers list', () => {
    expect(err([])).toEqual({ ok: false, error: 'noFiles' });
    expect(err([file('following.json', { relationships_following: [entry('carol')] })])).toEqual({ ok: false, error: 'needFollowers' });
    expect(err([file('recently_unfollowed_profiles.json', { relationships_unfollowed_users: [] })])).toEqual({ ok: false, error: 'needFollowers' });
  });

  it('people caps: 50,000 followers and 10,000 following are fine, one more is not (counted across files)', () => {
    const names = (n: number, p: string) => Array.from({ length: n }, (_, i) => entry(`${p}${i}`));
    expect(ok(parseExportFiles([file('followers_1.json', names(MAX_FOLLOWERS, 'f'))], NOW)).followers).toHaveLength(MAX_FOLLOWERS);
    expect(err([file('followers_1.json', names(MAX_FOLLOWERS, 'f')), file('followers_2.json', names(1, 'g'))])).toEqual({ ok: false, error: 'tooManyFollowers' });
    expect(err([file('followers_1.json', []), file('following.json', names(MAX_FOLLOWING + 1, 'h'))])).toEqual({ ok: false, error: 'tooManyFollowing' });
  });
});
