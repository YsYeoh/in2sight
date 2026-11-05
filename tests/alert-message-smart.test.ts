import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alertHref, WEEKLY_REVIEW_HREF } from '@/lib/alerts/message';
import { pushMessage } from '@/lib/alerts/push-message';
import { rowToNotification } from '@/lib/alerts/read';
import { DEFAULT_PREFS, type Prefs } from '@/lib/prefs';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const P = (locale: Prefs['locale'], o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, locale, ...o });

describe('Plan 17e messages', () => {
  it('spikes: own account name, numbers and a formatted day only', () => {
    expect(pushMessage({ kind: 'nonfollower_spike', accountId: A, payload: { username: 'cafe', pct: 61, usual: 20, day: '2026-10-13' } }, P('en'))).toEqual({
      title: 'Unusual reach from non-followers',
      body: "@cafe: 61% of the reach on 13 Oct 2026 came from people who don't follow you, well above the usual 20% for that weekday.",
      url: `/accounts/${A}?tab=growth`,
      tag: `nonfollower_spike:${A}`,
    });
    expect(pushMessage({ kind: 'unfollow_spike', accountId: A, payload: { username: 'cafe', count: 30, usual: 3, day: '2026-10-13' } }, P('en', { dateFormat: 'YYYY-MM-DD' })).body).toBe('@cafe: 30 unfollows on 2026-10-13, against about 3 on that weekday usually.');
    expect(pushMessage({ kind: 'nonfollower_spike', accountId: A, payload: { username: 'cafe', pct: 61, usual: 20, day: '2026-10-13' } }, P('zh-CN')).body).toMatch(/^@cafe：.*61%.*20%/);
  });

  it('summaries: plural counts in both languages; no account in the link or the tag', () => {
    const digest = (count: number, l: Prefs['locale'] = 'en') => pushMessage({ kind: 'digest', accountId: null, payload: { username: '', count } }, P(l));
    expect(digest(1)).toEqual({ title: 'Morning summary', body: '1 alert is waiting under the bell.', url: '/overview', tag: 'digest:all' });
    expect(digest(3).body).toBe('3 alerts are waiting under the bell.');
    expect(digest(3, 'zh-CN')).toMatchObject({ title: '早间摘要', body: '铃铛下有 3 条提醒等你查看。' });
    const weekly = (count: number) => pushMessage({ kind: 'weekly_digest', accountId: null, payload: { username: '', count } }, P('en')).body;
    expect(weekly(0)).toBe('Time to look back at last week.');
    expect(weekly(2)).toBe('Time to look back at last week. 2 alerts are also waiting under the bell.');
  });

  it('the weekly review opens the digest page once Plan 17d has built it, the Overview until then', () => {
    expect(alertHref('weekly_digest', null)).toBe(WEEKLY_REVIEW_HREF);
    if (existsSync(join(process.cwd(), 'app/(app)/plan'))) expect(WEEKLY_REVIEW_HREF).toMatch(/^\/plan([/?]|$)/);
    else expect(WEEKLY_REVIEW_HREF).toBe('/overview');
    expect(alertHref('digest', null)).toBe('/overview');
    expect(alertHref('unfollow_spike', A)).toBe(`/accounts/${A}?tab=growth`);
  });

  it('stored rows keep count, usual and a valid day; anything else is dropped', () => {
    const n = rowToNotification({ id: 1, kind: 'unfollow_spike', account_id: A, severity: 'warning', created_at: '2026-10-14T00:00:00Z', read_at: null, payload: { username: 'cafe', count: 30, usual: 3, day: '2026-10-13', name: 'someone' } });
    expect(n?.payload).toEqual({ username: 'cafe', count: 30, usual: 3, day: '2026-10-13' });
    expect(rowToNotification({ id: 2, kind: 'digest', account_id: null, severity: 'info', created_at: '2026-10-14T00:00:00Z', payload: { username: '', count: 'x', day: '13/10/2026' } })?.payload).toEqual({ username: '' });
  });
});
