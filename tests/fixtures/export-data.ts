// Shared ExportData fixtures for the export tests (workbook, report, routes). Deterministic: fixed today/now/tz.
import type { StoredAccount } from '@/lib/accounts/types';
import type { DailyRow } from '@/lib/analysis/types';
import type { PostRow, StoryRow } from '@/lib/dashboard/detail-read';
import type { ExportData } from '@/lib/export/read';
import { addDays } from '@/lib/sync/time';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

export const TODAY = '2026-10-15';
export const NOW = new Date('2026-10-15T04:00:00Z');
export const TZ = 'Asia/Kuala_Lumpur';
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const TAG = { id: '99999999-9999-4999-8999-999999999999', name: '=evil tag', color: 'chart-2' };

export const acct = (id: string, username: string, o: Partial<StoredAccount> = {}): StoredAccount => ({ id, igUserId: id, username, displayName: null, accountType: null, profilePictureUrl: null, groupName: null, status: 'active', archivedAt: null, lastError: null, tokenExpiresAt: '2026-12-01T00:00:00Z', connectedAt: '2026-09-01T00:00:00Z', ...o });

export const days = (n: number, reach: number | null, followers: number | null = 1000): DailyRow[] =>
  Array.from({ length: n }, (_, i) => ({ day: addDays(TODAY, i - n), followers, reach, views: reach === null ? null : reach * 2, accountsEngaged: null, interactions: reach === null ? null : reach / 10, follows: 5, unfollows: 2, linkTaps: null }));

export const post = (id: string, accountId: string, o: Partial<PostRow> = {}): PostRow => ({ id, accountId, mediaType: 'IMAGE', postedAt: '2026-10-10T02:00:00Z', permalink: `https://www.instagram.com/p/${id}/`, reach: 100, views: 150, likes: 10, comments: 2, shares: 1, saves: 3, caption: `caption ${id}`, tagIds: [], ...o });

export const story = (id: string, o: Partial<StoryRow> = {}): StoryRow => ({
  id,
  postedAt: '2026-10-14T01:00:00Z',
  expiresAt: '2026-10-15T01:00:00Z',
  permalink: null,
  snapshots: [{ capturedAt: '2026-10-14T23:30:00Z', reach: 40, views: 50, replies: 1, shares: 0, interactions: 2, tapsForward: 10, tapsBack: 1, exits: 5 }],
  ...o,
});

/** A Time Scope from a URL query (default: last 30 days), resolved at TODAY with account A's first day (20 days back) as the first captured day. */
export const scopeOf = (q = '') => resolveScope(parseTimeScope(new URLSearchParams(q)), TODAY, addDays(TODAY, -20));

/** Two accounts in one group: "brand.one" with data, "=brand<emoji>/two" (hostile name) with none at all. `q` = the Time Scope query. */
export function sampleData(q = ''): ExportData {
  return {
    accounts: [acct(A, 'brand.one', { groupName: 'Brand X', displayName: '品牌一号' }), acct(B, '=brand\u{1F600}/two', { groupName: 'Brand X' })],
    scope: scopeOf(q),
    sync: { [A]: { lastSuccessAt: '2026-10-15T03:00:00Z', lastErrorKey: null, consecutiveFailures: 0, dailyDoneThrough: '2026-10-14' } },
    daily: { [A]: days(20, 100), [B]: [] },
    posts: { [A]: [post('p1', A, { caption: '=1+1 cmd', tagIds: [TAG.id], mediaType: 'REELS' }), post('p2', A, { reach: null, likes: null, comments: null, shares: null, saves: null, caption: null })], [B]: [] },
    stories: { [A]: [story('s1')], [B]: [] },
    audience: {
      [A]: { age_gender: { day: '2026-10-14', data: { '18-24|F': 30, '18-24|M': 20 } }, country: { day: '2026-10-14', data: { MY: 60, SG: 40 } }, city: { day: '2026-10-14', data: { '=Kuala Lumpur': 50 } } },
      [B]: { age_gender: null, country: null, city: null },
    },
    online: { [A]: [], [B]: [] },
    tags: [TAG],
  };
}
