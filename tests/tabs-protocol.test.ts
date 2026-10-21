import { describe, expect, it } from 'vitest';
import { TITLE_MAX, isFramed, readFrameMessage, readShellMessage, tabUrl } from '@/lib/tabs/protocol';

const O = 'https://app.test';

describe('tabs protocol', () => {
  it('tabUrl: same-origin tab pages as path + query; everything else is null', () => {
    expect(tabUrl('/accounts/1?tab=posts#top', O)).toBe('/accounts/1?tab=posts');
    expect(tabUrl(`${O}/explorer?m=reach`, O)).toBe('/explorer?m=reach');
    for (const bad of ['https://evil.test/overview', '//evil.test/overview', 'javascript:alert(1)', '/login', '/login/verify', '/setup', '/auth/signout', '/report?scope=all', '/api/export/xlsx', '/', 'http://[', '/accounts-x'])
      expect(tabUrl(bad, O), bad).toBeNull();
  });

  it('isFramed: false at the top, true inside a frame or when the parent is cross-origin', () => {
    expect(isFramed(window)).toBe(false);
    const fake = (top: unknown) => ({ get self() { return 1; }, get top() { if (top === 'throw') throw new Error('cross-origin'); return top; } }) as unknown as Window;
    expect(isFramed(fake(2))).toBe(true);
    expect(isFramed(fake('throw'))).toBe(true);
  });

  it('readFrameMessage: nav (title trimmed and capped), open, history; URLs validated', () => {
    expect(readFrameMessage({ type: 'in2sight:nav', url: '/overview?from=2026-09-01', title: '  Overview  ' }, O)).toEqual({ type: 'in2sight:nav', url: '/overview?from=2026-09-01', title: 'Overview' });
    expect(readFrameMessage({ type: 'in2sight:nav', url: '/tags', title: 'x'.repeat(500) }, O)).toEqual({ type: 'in2sight:nav', url: '/tags', title: 'x'.repeat(TITLE_MAX) });
    expect(readFrameMessage({ type: 'in2sight:nav', url: '/tags', title: 42 }, O)).toEqual({ type: 'in2sight:nav', url: '/tags', title: '' });
    expect(readFrameMessage({ type: 'in2sight:open', url: `${O}/accounts/1`, extra: 1 }, O)).toEqual({ type: 'in2sight:open', url: '/accounts/1' });
    expect(readFrameMessage({ type: 'in2sight:history', dir: -1 }, O)).toEqual({ type: 'in2sight:history', dir: -1 });
    expect(readFrameMessage({ type: 'in2sight:history', dir: 1 }, O)).toEqual({ type: 'in2sight:history', dir: 1 });
  });

  it('readFrameMessage rejects anything else', () => {
    for (const bad of [null, undefined, 'in2sight:nav', 42, [], {}, { type: 'in2sight:nav' }, { type: 'in2sight:nav', url: 'https://evil.test/overview' }, { type: 'in2sight:open', url: '/login' }, { type: 'in2sight:open', url: 'javascript:alert(1)' }, { type: 'in2sight:history', dir: 2 }, { type: 'in2sight:history', dir: '-1' }, { type: 'in2sight:go', url: '/tags' }, { type: 'other', url: '/tags' }])
      expect(readFrameMessage(bad, O), JSON.stringify(bad)).toBeNull();
  });

  it('readShellMessage: go (validated URL) and refresh only', () => {
    expect(readShellMessage({ type: 'in2sight:go', url: '/tags?x=1' }, O)).toEqual({ type: 'in2sight:go', url: '/tags?x=1' });
    expect(readShellMessage({ type: 'in2sight:refresh', url: 'ignored' }, O)).toEqual({ type: 'in2sight:refresh' });
    for (const bad of [null, {}, { type: 'in2sight:go' }, { type: 'in2sight:go', url: 'https://evil.test/tags' }, { type: 'in2sight:go', url: '/login' }, { type: 'in2sight:nav', url: '/tags' }])
      expect(readShellMessage(bad, O), JSON.stringify(bad)).toBeNull();
  });
});
