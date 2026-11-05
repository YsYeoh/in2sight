// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { StoredAccount } from '@/lib/accounts/types';
import { spikeDays } from '@/lib/alerts/rules';
import { runAlerts, type AlertDeps, type AlertRunContext } from '@/lib/alerts/run';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/alerts/settings';
import { emptyState } from '@/lib/sync/schedule';
import { memoryAlertStore, pushSub } from './fixtures/alert-fakes';
import { account, fakeAccounts, memoryStore } from './fixtures/sync-fakes';

// Plan 17e: quiet hours, the morning summary and the weekly review, end to end through runAlerts with in-memory fakes.
const KL = 'Asia/Kuala_Lumpur'; // UTC+8; defaults: quiet 22:00-08:00, summary at 08:00
const HALF_HOUR = 1_800_000;
const broken = (id: string) => account({ id, status: 'needs_reconnect' });
const held = (kind: string, createdAt: string) => ({ kind, accountId: 'a1', severity: 'warning', dedupeKey: `${kind}:${createdAt}`, payload: { username: 'cafe' }, createdAt }) as never;

function setup(list: StoredAccount[], o: Parameters<typeof memoryAlertStore>[0] = {}, push: AlertDeps['push'] = vi.fn(async () => 201)) {
  const mem = memoryAlertStore({ subs: [pushSub(1)], ...o });
  const sync = memoryStore({ states: list.map((a) => ({ ...emptyState(a.id), lastSuccessAt: '2026-10-13T00:00:00.000Z' })) });
  const deps: AlertDeps = { store: mem.store, push };
  const ctx = (iso: string): AlertRunContext => {
    const t = Date.parse(iso);
    return { accounts: fakeAccounts(list).accounts, sync: sync.store, now: new Date(t), tz: KL, deadline: t + 10_000, clock: () => t };
  };
  const pushed = () => (push as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.parse(c[1] as string));
  return { mem, deps, ctx, push, pushed };
}

describe('quiet hours', () => {
  it('an unusual event at night is stored at once but not pushed', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1')]);
    expect(await runAlerts(deps, ctx('2026-10-14T16:00:00Z'))).toEqual({ created: 1, pushed: 0, failed: 0 }); // 00:00 KL
    expect(mem.rows.map((r) => r.kind)).toEqual(['needs_reconnect']);
    expect(push).not.toHaveBeenCalled();
  });

  it('quiet hours switched off (same hour twice): pushed at night as before', async () => {
    const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS, quietFrom: 9, quietTo: 9 };
    const { deps, ctx, push } = setup([broken('a1')], { settings });
    expect(await runAlerts(deps, ctx('2026-10-14T16:00:00Z'))).toMatchObject({ created: 1, pushed: 1 });
    expect(push).toHaveBeenCalledOnce();
  });

  it('a digest-only kind (token expiring) is never pushed on its own, even in the day', async () => {
    const { deps, ctx, push } = setup([account({ id: 'a1', tokenExpiresAt: '2026-10-19T00:00:00.000Z' })]);
    expect(await runAlerts(deps, ctx('2026-10-14T04:00:00Z'))).toMatchObject({ created: 1, pushed: 0 }); // 12:00 KL
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the morning summary', () => {
  const nightRows = () => [
    held('needs_reconnect', '2026-10-13T18:00:00.000Z'), // 02:00 KL: held by quiet hours
    held('token_expiring', '2026-10-13T05:00:00.000Z'), // 13:00 KL: digest-only
    held('reach_drop', '2026-10-13T05:00:00.000Z'), // 13:00 KL: was pushed at once
  ];

  it('at the end of quiet hours: ONE push counting what was held; it opens the Overview; no third-party data', async () => {
    const { deps, ctx, mem, pushed } = setup([]);
    mem.rows.push(...nightRows());
    expect(await runAlerts(deps, ctx('2026-10-14T00:30:00Z'))).toEqual({ created: 1, pushed: 1, failed: 0 }); // 08:30 KL
    expect(pushed()).toEqual([{ title: 'Morning summary', body: '2 alerts are waiting under the bell.', url: '/overview', tag: 'digest:all' }]);
    expect(mem.rows.at(-1)).toMatchObject({ kind: 'digest', accountId: null, dedupeKey: 'digest:2026-10-14', payload: { username: '', count: 2 } });
  });

  it('exactly one summary across the 48 ticks of a day, sent at the first tick after quiet hours', async () => {
    const { deps, ctx, mem, push } = setup([]);
    mem.rows.push(...nightRows());
    const start = Date.parse('2026-10-13T16:00:00Z'); // 00:00 KL on 2026-10-14
    const sentAt: string[] = [];
    for (let i = 0; i < 48; i++) {
      const iso = new Date(start + i * HALF_HOUR).toISOString();
      const before = (push as ReturnType<typeof vi.fn>).mock.calls.length;
      await runAlerts(deps, ctx(iso));
      if ((push as ReturnType<typeof vi.fn>).mock.calls.length > before) sentAt.push(iso);
    }
    expect(sentAt).toEqual(['2026-10-14T00:00:00.000Z']); // 08:00 KL
    expect(mem.rows.filter((r) => r.kind === 'digest')).toHaveLength(1);
  });

  it('a retried or overlapping tick never sends it twice (dedupe key digest:<day>)', async () => {
    const { deps, ctx, mem, push } = setup([]);
    mem.rows.push(...nightRows());
    await Promise.all([runAlerts(deps, ctx('2026-10-14T00:30:00Z')), runAlerts(deps, ctx('2026-10-14T00:30:00Z'))]);
    await runAlerts(deps, ctx('2026-10-14T01:00:00Z'));
    expect(push).toHaveBeenCalledOnce();
  });

  it('nothing held, the summary switched off, or no push configured: no summary at all', async () => {
    const a = setup([]);
    await runAlerts(a.deps, a.ctx('2026-10-14T00:30:00Z'));
    expect(a.mem.rows).toEqual([]);
    const b = setup([], { settings: { ...DEFAULT_ALERT_SETTINGS, push: { ...DEFAULT_ALERT_SETTINGS.push, digest: false } } });
    b.mem.rows.push(...nightRows());
    await runAlerts(b.deps, b.ctx('2026-10-14T00:30:00Z'));
    expect(b.push).not.toHaveBeenCalled();
    const c = setup([], {}, null);
    c.mem.rows.push(...nightRows());
    await runAlerts(c.deps, c.ctx('2026-10-14T00:30:00Z'));
    expect(c.mem.store.unreadBetween).not.toHaveBeenCalled();
    expect(c.mem.rows.some((r) => r.kind === 'digest')).toBe(false);
  });

  it('a failing summary read is counted and never stops the instant pushes', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1')]);
    vi.mocked(mem.store.unreadBetween).mockRejectedValue(new Error('alert store: unreadBetween failed'));
    expect(await runAlerts(deps, ctx('2026-10-14T04:00:00Z'))).toEqual({ created: 1, pushed: 1, failed: 1 });
    expect(push).toHaveBeenCalledOnce();
  });

  it('out of time: no summary is read or sent', async () => {
    const { deps, mem } = setup([]);
    mem.rows.push(...nightRows());
    const t = Date.parse('2026-10-14T00:30:00Z');
    await runAlerts(deps, { accounts: fakeAccounts([]).accounts, sync: memoryStore().store, now: new Date(t), tz: KL, deadline: t, clock: () => t });
    expect(mem.store.unreadBetween).not.toHaveBeenCalled();
  });
});

describe('the weekly review', () => {
  it("on the week's first day the morning push IS the weekly review, with the held count", async () => {
    const { deps, ctx, mem, pushed } = setup([]);
    mem.rows.push(held('needs_reconnect', '2026-10-18T17:00:00.000Z')); // 01:00 KL Monday
    expect(await runAlerts(deps, ctx('2026-10-19T00:30:00Z'))).toEqual({ created: 2, pushed: 1, failed: 0 }); // 08:30 KL Monday
    expect(pushed()).toEqual([{ title: 'Weekly review', body: 'Time to look back at last week. 1 alert is also waiting under the bell.', url: '/plan/digest', tag: 'weekly_digest:all' }]);
    expect(mem.rows.map((r) => r.dedupeKey).slice(-2)).toEqual(['digest:2026-10-19', 'weekly_digest:2026-10-19']);
  });

  it('follows the week-start setting; nothing held still sends the review; Chinese when the profile is Chinese', async () => {
    const sun = setup([], { prefs: { weekStart: 'sun' } });
    await runAlerts(sun.deps, sun.ctx('2026-10-19T00:30:00Z'));
    expect(sun.push).not.toHaveBeenCalled();
    await runAlerts(sun.deps, sun.ctx('2026-10-25T00:30:00Z')); // Sunday
    expect(sun.pushed()[0].body).toBe('Time to look back at last week.');
    const zh = setup([], { locale: 'zh-CN' });
    await runAlerts(zh.deps, zh.ctx('2026-10-19T00:30:00Z'));
    expect(zh.pushed()[0]).toMatchObject({ title: '每周回顾', body: '来回顾一下上周的表现吧。' });
  });
});

describe('spike data', () => {
  it('reads reach by follow type per account for exactly spikeDays(today), in the same parallel batch', async () => {
    const { deps, ctx, mem } = setup([account({ id: 'a1' })]);
    await runAlerts(deps, ctx('2026-10-14T04:00:00Z'));
    expect(mem.store.reachByFollow).toHaveBeenCalledWith('a1', spikeDays('2026-10-14'));
  });
});
