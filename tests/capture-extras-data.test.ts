import { describe, expect, it } from 'vitest';
import { igData } from '@/lib/instagram/data';
import { EXTRA_GROUPS } from '@/lib/instagram/metrics';
import { supabaseSyncStore } from '@/lib/sync/store';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const NOW = '2026-10-14T02:00:00.000Z';

function recordFetch(respond: (u: URL) => unknown) {
  const seen: URL[] = [];
  const fn = (async (input: string | URL) => {
    const u = new URL(String(input));
    seen.push(u);
    return json(respond(u));
  }) as typeof fetch;
  return { fn, seen };
}

describe('EXTRA_GROUPS (metric names live only in lib/instagram/metrics.ts)', () => {
  it('never asks reposts per media, never follows/profile_visits for Reels, one metric per Story call', () => {
    const all = Object.values(EXTRA_GROUPS).flat();
    expect(all.flatMap((g) => Object.keys(g.metrics))).not.toContain('reposts');
    expect(EXTRA_GROUPS.reels.flatMap((g) => Object.keys(g.metrics))).not.toEqual(expect.arrayContaining(['follows']));
    expect(EXTRA_GROUPS.reels.flatMap((g) => Object.keys(g.metrics))).not.toEqual(expect.arrayContaining(['profile_visits']));
    for (const g of EXTRA_GROUPS.story) expect(Object.keys(g.metrics)).toHaveLength(1);
    for (const g of all.filter((x) => x.breakdown)) expect(Object.keys(g.metrics)).toHaveLength(1);
  });
  it('capability keys are unique per scope', () => {
    for (const groups of Object.values(EXTRA_GROUPS)) expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
  });
});

describe('extraInsights', () => {
  it('plain group: one call with exactly the group metrics, no breakdown; maps totals', async () => {
    const f = recordFetch(() => ({ data: [{ name: 'ig_reels_avg_watch_time', values: [{ value: 5120 }] }, { name: 'reels_skip_rate', values: [{ value: 41.5 }] }] }));
    const v = await igData('v25.0', f.fn).extraInsights('IGQ-secret', 'm1', ['ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate']);
    expect(v).toEqual({ ig_reels_avg_watch_time: 5120, reels_skip_rate: 41.5 });
    expect(f.seen[0].pathname).toBe('/v25.0/m1/insights');
    expect(f.seen[0].searchParams.get('metric')).toBe('ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate');
    expect(f.seen[0].searchParams.has('breakdown')).toBe(false);
  });

  it('breakdown group: asks the breakdown and returns the dimension map', async () => {
    const f = recordFetch(() => ({ data: [{ name: 'profile_activity', total_value: { value: 4, breakdowns: [{ dimension_keys: ['action_type'], results: [{ dimension_values: ['BIO_LINK_CLICKED'], value: 3 }, { dimension_values: ['DIRECTION'], value: 1 }] }] } }] }));
    const v = await igData('v25.0', f.fn).extraInsights('IGQ-secret', 'm1', ['profile_activity'], 'action_type');
    expect(v).toEqual({ BIO_LINK_CLICKED: 3, DIRECTION: 1 });
    expect(f.seen[0].searchParams.get('breakdown')).toBe('action_type');
  });

  it('nothing sent -> empty object (never zeros)', async () => {
    const f = recordFetch(() => ({ data: [] }));
    expect(await igData('v25.0', f.fn).extraInsights('t', 'm1', ['follows'])).toEqual({});
  });

  it('storyInsights keeps SWIPE_FORWARD whatever its case', async () => {
    const f = recordFetch((u) =>
      u.searchParams.get('metric') === 'navigation'
        ? { data: [{ name: 'navigation', total_value: { value: 9, breakdowns: [{ results: [{ dimension_values: ['SWIPE_FORWARD'], value: 7 }, { dimension_values: ['tap_exit'], value: 2 }] }] } }] }
        : { data: [] },
    );
    expect(await igData('v25.0', f.fn).storyInsights('t', 's1')).toMatchObject({ swipeForward: 7, exits: 2, tapsForward: null });
  });
});

describe('store: extras columns', () => {
  function recorder() {
    const calls: { table: string; op: string; row: unknown; filters: unknown[][] }[] = [];
    const db = {
      from(table: string) {
        const c = { table, op: '', row: undefined as unknown, filters: [] as unknown[][] };
        calls.push(c);
        const chain: Record<string, unknown> = {
          upsert: (r: unknown) => ((c.op = 'upsert'), (c.row = r), chain),
          update: (r: unknown) => ((c.op = 'update'), (c.row = r), chain),
          eq: (...a: unknown[]) => (c.filters.push(a), chain),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
        };
        return chain;
      },
    };
    return { db: db as never, calls };
  }

  it('insertMetrics writes the new columns as null when a snapshot has no extras (never 0)', async () => {
    const r = recorder();
    await supabaseSyncStore(r.db).insertMetrics('s1', NOW, { reach: 1, views: 2, likes: null, comments: null, shares: 0, saves: null, totalInteractions: 1, replies: 0, tapsForward: 3, tapsBack: 1, exits: 1, swipeForward: 4 });
    expect(r.calls[0].row).toMatchObject({ swipe_forward: 4, follows: null, profile_visits: null, profile_activity: null, avg_watch_ms: null, total_watch_ms: null, skip_rate: null });
  });

  it('updateMetricExtras writes only the given fields onto that one snapshot; nothing given = no query', async () => {
    const r = recorder();
    const s = supabaseSyncStore(r.db);
    await s.updateMetricExtras('p1', NOW, { follows: 3, profileActivity: { BIO_LINK_CLICKED: 2 } });
    expect(r.calls[0]).toMatchObject({ table: 'media_metrics', op: 'update', row: { follows: 3, profile_activity: { BIO_LINK_CLICKED: 2 } }, filters: [['media_id', 'p1'], ['captured_at', NOW]] });
    expect(Object.keys(r.calls[0].row as object)).toEqual(['follows', 'profile_activity']);
    await s.updateMetricExtras('p1', NOW, {});
    expect(r.calls).toHaveLength(1);
  });
});
