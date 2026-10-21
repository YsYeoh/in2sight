import { describe, expect, it } from 'vitest';
import { MAX_FOLLOWERS, MAX_FOLLOWING } from '@/lib/followers/parse';
import { MAX_BODY_BYTES, toPayload, validateUpload, type Upload } from '@/lib/followers/payload';

const NOW = 1_793_000_000;
const TODAY = '2026-10-26';
const T1 = 1_700_000_000;
const upload: Upload = { takenOn: '2026-10-20', followers: [{ username: 'alice', at: T1 }, { username: 'bob', at: null }], following: [{ username: 'carol', at: T1 }] };
const body = (patch: Record<string, unknown> = {}) => ({ ...JSON.parse(toPayload(upload)), ...patch });

describe('toPayload → validateUpload', () => {
  it('round-trips the compact form: names with their times as pairs, following optional', () => {
    expect(JSON.parse(toPayload(upload))).toEqual({ v: 1, takenOn: '2026-10-20', followers: [['alice', T1], ['bob', null]], following: [['carol', T1]] });
    expect(validateUpload(JSON.parse(toPayload(upload)), TODAY, NOW)).toEqual(upload);
    const noFollowing = { ...upload, following: null };
    expect(validateUpload(JSON.parse(toPayload(noFollowing)), TODAY, NOW)).toEqual(noFollowing);
    expect(validateUpload(body({ followers: [] }), TODAY, NOW)).toEqual({ ...upload, followers: [] });
  });

  it('both lists at their caps with 30-character names stay under the body cap (and under Vercel\'s 4.5 MB)', () => {
    const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ username: `${p}${String(i).padStart(29, '0')}`, at: 1_790_000_000 }));
    const big = toPayload({ takenOn: TODAY, followers: many(MAX_FOLLOWERS, 'a'), following: many(MAX_FOLLOWING, 'b') });
    expect(new TextEncoder().encode(big).length).toBeLessThan(MAX_BODY_BYTES);
    expect(MAX_BODY_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});

describe('validateUpload rejects anything else (null, nothing repaired)', () => {
  it.each([
    ['not an object', null],
    ['an array', []],
    ['a string', 'x'],
    ['an extra key', body({ extra: 1 })],
    ['a missing key', JSON.parse(toPayload(upload).replace(',"following":[["carol",1700000000]]', ''))],
    ['a "__proto__" key', JSON.parse(toPayload(upload).replace('{"v":1', '{"__proto__":{"x":1},"v":1'))],
    ['another version', body({ v: 2 })],
    ['a date that does not exist', body({ takenOn: '2026-02-30' })],
    ['a date in the future', body({ takenOn: '2026-10-27' })],
    ['a date before Instagram', body({ takenOn: '2010-10-05' })],
    ['a date with a time', body({ takenOn: '2026-10-20T00:00:00Z' })],
    ['followers not a list', body({ followers: { alice: 1 } })],
    ['followers null', body({ followers: null })],
    ['an upper-case name', body({ followers: [['Alice', T1]] })],
    ['a name with a space', body({ followers: [['al ice', T1]] })],
    ['a 31-character name', body({ followers: [['a'.repeat(31), T1]] })],
    ['a duplicate name', body({ followers: [['alice', T1], ['alice', null]] })],
    ['a pair of three', body({ followers: [['alice', T1, 'x']] })],
    ['a time as text', body({ followers: [['alice', '1700000000']] })],
    ['a time in milliseconds', body({ followers: [['alice', T1 * 1000]] })],
    ['a fractional time', body({ followers: [['alice', T1 + 0.5]] })],
    ['a time before 2010', body({ followers: [['alice', 1_000_000_000]] })],
    ['a bad following entry', body({ following: [['carol', T1], 42] })],
    ['too many followers', body({ followers: Array.from({ length: MAX_FOLLOWERS + 1 }, (_, i) => [`u${i}`, null]) })],
    ['too many following', body({ following: Array.from({ length: MAX_FOLLOWING + 1 }, (_, i) => [`u${i}`, null]) })],
  ])('%s', (_name, b) => {
    expect(validateUpload(b, TODAY, NOW)).toBeNull();
  });
});
