// In-memory fakes for the sync runner and tick tests.
import { vi } from 'vitest';
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import type { IgData, MediaExtras, MediaMetricValues } from '@/lib/instagram/data';
import type { CoverStatus } from '@/lib/sync/covers';
import { emptyState, type SyncState } from '@/lib/sync/schedule';
import type { ProgressWrite, StatePatch, SyncRun, SyncStore } from '@/lib/sync/store';

export const METRICS: MediaMetricValues = { reach: 10, views: 20, likes: 1, comments: 0, shares: 0, saves: 0, totalInteractions: 1, replies: null, tapsForward: null, tapsBack: null, exits: null };

export const account = (o: Partial<StoredAccount> & { id: string }): StoredAccount => ({
  igUserId: `ig-${o.id}`,
  username: `user_${o.id}`,
  displayName: null,
  accountType: 'MEDIA_CREATOR',
  profilePictureUrl: null,
  groupName: null,
  status: 'active',
  archivedAt: null,
  lastError: null,
  tokenExpiresAt: '2026-12-01T00:00:00.000Z',
  connectedAt: '2026-10-01T00:00:00.000Z',
  ...o,
});

/** Every method is a vi.fn with a happy-path default; override per test with mockImplementation / mockRejectedValue. */
export function fakeIg() {
  return {
    profile: vi.fn<IgData['profile']>(async () => ({ followersCount: 1520, followingCount: 300, mediaCount: 42 })),
    accountDayBreakdown: vi.fn<IgData['accountDayBreakdown']>(async () => []),
    accountDay: vi.fn<IgData['accountDay']>(async () => ({ reach: 1, views: 2, accountsEngaged: 3, totalInteractions: 4, linkTaps: 5, follows: 6, unfollows: 7 })),
    listMedia: vi.fn<IgData['listMedia']>(async () => []),
    listStories: vi.fn<IgData['listStories']>(async () => []),
    feedInsights: vi.fn<IgData['feedInsights']>(async () => METRICS),
    storyInsights: vi.fn<IgData['storyInsights']>(async () => METRICS),
    commentsPage: vi.fn<IgData['commentsPage']>(async () => ({ items: [], next: null })),
    mediaCover: vi.fn<IgData['mediaCover']>(async () => ({ mediaType: 'IMAGE', productType: null, likeCount: null, commentsCount: null, isSharedToFeed: null, mediaUrl: null, thumbnailUrl: null, childrenCount: null, children: null })),
    extraInsights: vi.fn<IgData['extraInsights']>(async () => ({})),
    audience: vi.fn<IgData['audience']>(async () => ({})),
    onlineFollowers: vi.fn<IgData['onlineFollowers']>(async () => []),
    refresh: vi.fn<IgData['refresh']>(async () => ({ accessToken: 'IGQ-new', expiresAt: '2027-01-01T00:00:00.000Z' })),
  } satisfies IgData;
}

export interface MemoryInit {
  states?: SyncState[];
  tokens?: Record<string, string>;
  tz?: string;
  media?: { id: string; accountId: string; postedAt: string; lastMetricsAt: string | null; productType?: string | null }[];
}

export function memoryStore(init: MemoryInit = {}) {
  const states = new Map((init.states ?? []).map((s) => [s.accountId, { ...s, leaseId: null as string | null }]));
  const media = new Map((init.media ?? []).map((m) => [m.id, { ...m, kind: 'IMAGE', gone: false }]));
  const daily: { accountId: string; day: string }[] = [];
  const followers: { accountId: string; day: string; followers: number }[] = [];
  const metrics: { mediaId: string; capturedAt: string }[] = [];
  const extras: { mediaId: string; capturedAt: string; e: Partial<MediaExtras> }[] = [];
  const audience: { accountId: string; kind: string }[] = [];
  const online: { accountId: string; day: string }[] = [];
  const snapshots: { accountId: string; capturedAt: string; followers: number | null }[] = [];
  const breakdowns: { accountId: string; day: string; rows: number }[] = [];
  const children: { mediaId: string; position: number; mediaType: string | null }[] = [];
  /** cover state per media id; a media item without an entry is 'pending' with 0 attempts (the column default) */
  const covers = new Map<string, { status: CoverStatus; attempts: number; triedAt: string | null; path?: string }>();
  const uploads: { path: string; bytes: number; contentType: string }[] = [];
  /** comments_count / comments_synced_count per media id (only media listed here have comments) */
  const commentCounts = new Map<string, { count: number; synced: number | null }>();
  const comments: { accountId: string; mediaId: string; id: string; seenAt: string }[] = [];
  const archived: { accountId: string; endpoint: string; body: unknown; capturedAt: string }[] = [];
  const runs: SyncRun[] = [];
  const saved: { accountId: string; patch: StatePatch }[] = [];
  const progress: { accountId: string; p: ProgressWrite }[] = [];
  const store: SyncStore = {
    ownerTimezone: async () => init.tz ?? 'Asia/Kuala_Lumpur',
    loadStates: async (ids) => new Map(ids.map((id) => [id, states.get(id) ?? emptyState(id)])),
    claimLease: async (id, leaseId, until, now) => {
      const s = states.get(id) ?? { ...emptyState(id), leaseId: null };
      if (s.leaseUntil && s.leaseUntil >= now) return null;
      const claimed = { ...s, leaseId, leaseUntil: until, lastAttemptAt: now }; // like the real UPDATE: stamps the attempt
      states.set(id, claimed);
      return claimed;
    },
    saveState: async (id, leaseId, patch) => {
      const s = states.get(id);
      if (!s || s.leaseId !== leaseId) return;
      saved.push({ accountId: id, patch });
      states.set(id, { ...s, ...patch, lastSuccessAt: patch.lastSuccessAt ?? s.lastSuccessAt, leaseId: null, leaseUntil: null });
    },
    getToken: async (id) => init.tokens?.[id] ?? null,
    upsertDaily: async (accountId, day) => void daily.push({ accountId, day }),
    upsertFollowers: async (accountId, day, n) => void followers.push({ accountId, day, followers: n }),
    upsertMedia: async (accountId, items) => {
      for (const i of items) media.set(i.id, { id: i.id, accountId, postedAt: i.postedAt, lastMetricsAt: media.get(i.id)?.lastMetricsAt ?? null, kind: i.kind, gone: media.get(i.id)?.gone ?? false });
      for (const i of items) (i.details?.children ?? []).forEach((ch, position) => children.push({ mediaId: i.id, position, mediaType: ch.mediaType }));
    },
    mediaForMetrics: async (accountId, since) =>
      [...media.values()].filter((m) => m.accountId === accountId && m.kind !== 'STORY' && !m.gone && (m.postedAt >= since || m.lastMetricsAt === null)).map(({ id, postedAt, lastMetricsAt, kind, productType }) => ({ id, postedAt, lastMetricsAt, kind, productType })),
    insertMetrics: async (mediaId, capturedAt) => void metrics.push({ mediaId, capturedAt }),
    updateMetricExtras: async (mediaId, capturedAt, e) => void extras.push({ mediaId, capturedAt, e }),
    markCaptured: async (ids, at) => {
      for (const id of ids) {
        const m = media.get(id);
        if (m) m.lastMetricsAt = at;
      }
    },
    markGone: async (id) => {
      const m = media.get(id);
      if (m) m.gone = true;
    },
    upsertAudience: async (accountId, _day, kind) => void audience.push({ accountId, kind }),
    coverRefs: async (accountId, opts) =>
      [...media.values()]
        .filter((m) => m.accountId === accountId && !m.gone && (opts.ids ? opts.ids.includes(m.id) : m.kind !== 'STORY'))
        .map((m) => ({ id: m.id, kind: m.kind, postedAt: m.postedAt, status: 'pending' as CoverStatus, attempts: 0, triedAt: null, ...covers.get(m.id) }))
        .filter((r) => r.status === 'pending' || r.status === 'failed')
        .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1))
        .slice(0, opts.limit),
    markCover: async (id, r) => void covers.set(id, r),
    mediaForComments: async (accountId, since) =>
      [...media.values()]
        .filter((m) => m.accountId === accountId && m.kind !== 'STORY' && !m.gone && m.postedAt >= since && (commentCounts.get(m.id)?.count ?? 0) > 0)
        .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1))
        .map((m) => ({ id: m.id, commentsCount: commentCounts.get(m.id)!.count, syncedCount: commentCounts.get(m.id)!.synced })),
    upsertComments: async (accountId, mediaId, items, seenAt) => {
      for (const i of items) {
        const at = comments.findIndex((x) => x.id === i.id);
        if (at >= 0) comments.splice(at, 1);
        comments.push({ accountId, mediaId, id: i.id, seenAt });
      }
    },
    archiveSnapshot: async (accountId, endpoint, body, capturedAt) => void archived.push({ accountId, endpoint, body, capturedAt }),
    markCommentsSynced: async (id, n) => void commentCounts.set(id, { count: commentCounts.get(id)?.count ?? n, synced: n }),
    uploadCover: async (path, bytes, contentType) => void uploads.push({ path, bytes: bytes.byteLength, contentType }),
    expireStoryCovers: async (accountId, nowIso) => {
      for (const m of media.values()) {
        const st = covers.get(m.id)?.status ?? 'pending';
        if (m.accountId === accountId && m.kind === 'STORY' && (st === 'pending' || st === 'failed') && Date.parse(m.postedAt) + 86_400_000 < Date.parse(nowIso)) covers.set(m.id, { status: 'unavailable', attempts: covers.get(m.id)?.attempts ?? 0, triedAt: null });
      }
    },
    upsertOnlineFollowers: async (accountId, day) => void online.push({ accountId, day }),
    insertFollowerSnapshot: async (accountId, capturedAt, v) => void snapshots.push({ accountId, capturedAt, followers: v.followers }),
    upsertDailyBreakdown: async (accountId, day, rows) => void breakdowns.push({ accountId, day, rows: rows.length }),
    recordRun: async (r) => void runs.push(r),
    writeProgress: async (accountId, p) => void progress.push({ accountId, p }),
  };
  return { store, states, media, children, covers, uploads, commentCounts, comments, archived, daily, followers, metrics, extras, audience, online, snapshots, breakdowns, runs, saved, progress };
}

export function fakeAccounts(list: StoredAccount[]) {
  const byId = new Map(list.map((a) => [a.id, a]));
  const tokens: Record<string, { accessToken: string; expiresAt: string }> = {};
  const accounts: AccountsStore = {
    list: async () => [...byId.values()],
    getById: async (id) => byId.get(id) ?? null,
    findByIgUserId: async (ig) => [...byId.values()].find((a) => a.igUserId === ig) ?? null,
    insert: async () => {
      throw new Error('not used');
    },
    update: async (id, patch) => {
      const a = { ...byId.get(id)!, ...patch };
      byId.set(id, a);
      return a;
    },
    saveToken: async (id, t) => void (tokens[id] = t),
    remove: async (id) => void byId.delete(id),
  };
  return { accounts, byId, tokens };
}
