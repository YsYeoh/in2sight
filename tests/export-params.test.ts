import { describe, expect, it } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { contentDisposition, exportBasename, filenameFromDisposition } from '@/lib/export/filename';
import { exportScopes, NOTE_MAX, parseExportParams, parseReportParams, parseScope, resolveScope, scopeLabel, scopeParam, TITLE_MAX } from '@/lib/export/params';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const acct = (id: string, username: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: null, connectedAt: '2026-09-01T00:00:00Z', ...o });
const accounts = [acct(B, 'zeta', { groupName: 'Brand X' }), acct(A, 'alpha', { groupName: 'Brand X' }), acct(C, 'gone', { status: 'archived', groupName: 'Old' })];
const q = (s: string) => new URLSearchParams(s);

const BRAND = '品牌'; // 品牌
const SPARKLE = '✨'; // ✨
const GRIN = '\u{1F600}'; // 😀

describe('parseScope / parseExportParams', () => {
  it('accepts all, a group by its exact name, an account by uuid (lower-cased)', () => {
    expect(parseScope('all')).toEqual({ kind: 'all' });
    expect(parseScope('g:Brand X')).toEqual({ kind: 'group', name: 'Brand X' });
    expect(parseScope(`a:${A.toUpperCase()}`)).toEqual({ kind: 'account', id: A });
    for (const s of scopeParamCases()) expect(parseScope(scopeParam(s))).toEqual(s);
  });

  it('rejects anything else', () => {
    for (const v of [null, '', 'ALL', 'a:', 'a:123', 'a:../../etc', 'g:', 'g: Brand X', 'g:Brand\u0000X', `g:${'x'.repeat(41)}`, 'x:all']) expect(parseScope(v), String(v)).toBeNull();
  });

  it('needs exactly one scope; old period links and no range at all still work', () => {
    expect(parseExportParams(q('scope=all&period=30'))).toEqual({ ok: true, params: { scope: { kind: 'all' }, time: { range: '30d', cmp: 'prev', gran: 'auto' } } });
    expect(parseExportParams(q('scope=all&period=7'))).toMatchObject({ ok: true, params: { time: { range: '7d' } } });
    expect(parseExportParams(q('scope=all'))).toMatchObject({ ok: true, params: { time: { range: '30d' } } });
    for (const s of ['period=30', 'scope=all&period=31', 'scope=all&period=30.0x', 'scope=all&scope=g:Brand%20X&period=7', 'scope=all&period=7&period=90'])
      expect(parseExportParams(q(s)), s).toEqual({ ok: false, error: 'bad_params' });
  });

  it('takes the Time Scope strictly: canonical keys only, real days, pairs complete', () => {
    expect(parseExportParams(q('scope=all&from=2026-09-01&to=2026-09-30&cmp=yoy&gran=week'))).toEqual({
      ok: true,
      params: { scope: { kind: 'all' }, time: { range: { from: '2026-09-01', to: '2026-09-30' }, cmp: 'yoy', gran: 'week' } },
    });
    expect(parseExportParams(q('scope=all&from=1y&cfrom=2024-01-01&cto=2024-12-31'))).toMatchObject({ ok: true, params: { time: { range: '1y', cmp: { from: '2024-01-01', to: '2024-12-31' } } } });
    const bad = [
      'scope=all&from=junk',
      'scope=all&from=2026-09-01', // half a pair
      'scope=all&from=30d&to=2026-09-30',
      'scope=all&from=2026-02-30&to=2026-03-01',
      'scope=all&from=7d&from=30d',
      'scope=all&cmp=evil',
      'scope=all&cfrom=2025-01-01',
      'scope=all&gran=hour',
      'scope=all&month=2026-09', // picker shorthands are for the pages only
      'scope=all&week=2026-09-01',
      'scope=all&quarter=2026-Q3',
    ];
    for (const s of bad) expect(parseExportParams(q(s)), s).toEqual({ ok: false, error: 'bad_params' });
  });

  it('rejects a reversed or over-long range (and comparison range) instead of repairing it; MAX_DAYS exactly and one day are fine', () => {
    const bad = [
      'scope=all&from=2026-09-30&to=2026-09-01', // reversed
      'scope=all&from=2020-01-01&to=2026-10-17', // far longer than MAX_DAYS
      'scope=all&from=2021-10-13&to=2026-10-17', // MAX_DAYS + 1 days
      'scope=all&from=30d&cfrom=2025-03-31&cto=2025-01-01', // reversed comparison
      'scope=all&from=30d&cfrom=2000-01-01&cto=2026-10-17', // over-long comparison
    ];
    for (const s of bad) expect(parseExportParams(q(s)), s).toEqual({ ok: false, error: 'bad_params' });
    for (const s of ['scope=all&from=2021-10-14&to=2026-10-17', 'scope=all&from=2026-09-01&to=2026-09-01', 'scope=all&from=30d&cfrom=2021-10-14&cto=2026-10-17'])
      expect(parseExportParams(q(s)).ok, s).toBe(true);
  });
});

function scopeParamCases() {
  return [{ kind: 'all' as const }, { kind: 'group' as const, name: `${BRAND} ${SPARKLE}` }, { kind: 'account' as const, id: A }];
}

describe('parseReportParams', () => {
  const base = 'scope=all&period=7';
  it('sections are allow-listed, de-duplicated and put in display order', () => {
    const r = parseReportParams(q(`${base}&sections=flags,kpis,flags`));
    expect(r.ok && r.params.sections).toEqual(['kpis', 'flags']);
    for (const s of ['', '&sections=', '&sections=kpis,evil', '&sections=kpis&sections=flags']) expect(parseReportParams(q(base + s)), s).toEqual({ ok: false, error: 'bad_params' });
  });

  it('title: one line, whitespace collapsed, at most 120 code points (CJK/emoji count as one)', () => {
    const ok = parseReportParams(q(`${base}&sections=kpis&title=${encodeURIComponent(`  月度   报告 ${SPARKLE} `)}`));
    expect(ok.ok && ok.params.title).toBe(`月度 报告 ${SPARKLE}`);
    expect(parseReportParams(q(`${base}&sections=kpis&title=${encodeURIComponent(GRIN.repeat(TITLE_MAX))}`)).ok).toBe(true);
    for (const t of [GRIN.repeat(TITLE_MAX + 1), 'a\nb', 'a‮b', 'a\u0007b'])
      expect(parseReportParams(q(`${base}&sections=kpis&title=${encodeURIComponent(t)}`)).ok, JSON.stringify(t)).toBe(false);
  });

  it('note keeps line breaks (CRLF normalised, 3+ blank lines squeezed), max 1000 code points', () => {
    const r = parseReportParams(q(`${base}&sections=kpis&note=${encodeURIComponent('line 1\r\n\r\n\r\n\r\nline 2')}`));
    expect(r.ok && r.params.note).toBe('line 1\n\nline 2');
    expect(parseReportParams(q(`${base}&sections=kpis&note=${'x'.repeat(NOTE_MAX + 1)}`)).ok).toBe(false);
    const empty = parseReportParams(q(`${base}&sections=kpis`));
    expect(empty.ok && [empty.params.title, empty.params.note]).toEqual(['', '']);
  });
});

describe('resolveScope / exportScopes / scopeLabel', () => {
  it('all = live accounts by username; a group or account must exist and be live', () => {
    expect(resolveScope({ kind: 'all' }, accounts)?.map((a) => a.username)).toEqual(['alpha', 'zeta']);
    expect(resolveScope({ kind: 'group', name: 'Brand X' }, accounts)?.map((a) => a.username)).toEqual(['alpha', 'zeta']);
    expect(resolveScope({ kind: 'account', id: A }, accounts)?.map((a) => a.id)).toEqual([A]);
    expect(resolveScope({ kind: 'group', name: 'Old' }, accounts)).toBeNull(); // only archived accounts in it
    expect(resolveScope({ kind: 'account', id: C }, accounts)).toBeNull(); // archived = hidden everywhere
    expect(resolveScope({ kind: 'all' }, [])).toEqual([]); // no accounts: still a valid (empty) export
  });

  it('dialog options: all, groups A→Z, then accounts A→Z', () => {
    expect(exportScopes(accounts)).toEqual([
      { value: 'all', kind: 'all', name: '' },
      { value: 'g:Brand X', kind: 'group', name: 'Brand X' },
      { value: `a:${A}`, kind: 'account', name: 'alpha' },
      { value: `a:${B}`, kind: 'account', name: 'zeta' },
    ]);
  });

  it('labels', () => {
    expect(scopeLabel({ kind: 'all' }, accounts)).toBe('all');
    expect(scopeLabel({ kind: 'group', name: 'Brand X' }, accounts)).toBe('Brand X');
    expect(scopeLabel({ kind: 'account', id: A }, accounts)).toBe('@alpha');
  });
});

describe('Content-Disposition', () => {
  it('hostile names: ASCII fallback + exact UTF-8 filename*, no quotes, slashes or line breaks', () => {
    const h = contentDisposition(exportBasename(`=cmd|/c calc ${GRIN} ${BRAND}/"x"\r\n`, { from: '2026-09-16', to: '2026-10-15' }), 'xlsx');
    expect(h).not.toMatch(/[\r\n]/);
    const ascii = h.match(/filename="([^"]*)"/)![1];
    expect(ascii).toMatch(/^[A-Za-z0-9._-]+\.xlsx$/);
    expect(ascii).toBe('in2sight-cmd-c-calc-x-2026-09-16_2026-10-15.xlsx');
    const star = h.match(/filename\*=UTF-8''(\S+)$/)![1];
    expect(star).toMatch(/^[A-Za-z0-9%._~!-]+$/); // RFC 5987 attr-chars only
    expect(decodeURIComponent(star)).toBe(`in2sight-=cmd-c calc ${GRIN} ${BRAND}-x-2026-09-16_2026-10-15.xlsx`);
  });

  it('an all-unicode name still gets a usable ASCII fallback; long names are capped', () => {
    expect(contentDisposition(BRAND, 'pdf')).toContain('filename="in2sight.pdf"');
    const long = contentDisposition('x'.repeat(500), 'pdf').match(/filename="([^"]*)"/)![1];
    expect(long.length).toBe(100 + '.pdf'.length);
  });

  it('round-trips through the browser helper; junk headers fall back', () => {
    const h = contentDisposition(exportBasename(`@${BRAND} ${SPARKLE}`, { from: '2026-10-01', to: '2026-10-15' }), 'pdf');
    expect(filenameFromDisposition(h, 'x.pdf')).toBe(`in2sight-@${BRAND} ${SPARKLE}-2026-10-01_2026-10-15.pdf`);
    expect(filenameFromDisposition('attachment; filename="a.xlsx"', 'x.xlsx')).toBe('a.xlsx');
    expect(filenameFromDisposition(null, 'x.pdf')).toBe('x.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''..%2F..%2Fevil.exe", 'x.pdf')).toBe('x.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''..%2F..%2Fevil.pdf", 'x.pdf')).toBe('-..-evil.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", 'x.pdf')).toBe('x.pdf');
  });
});
