import { describe, expect, it, vi } from 'vitest';
import { runAlerts, type AlertDeps, type AlertRunContext } from '@/lib/alerts/run';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import { emptyState } from '@/lib/sync/schedule';
import type { StoredAccount } from '@/lib/accounts/types';
import { memoryAlertStore, pushSub } from './fixtures/alert-fakes';
import { account, fakeAccounts, memoryStore } from './fixtures/sync-fakes';

const T0 = Date.parse('2026-10-14T02:00:00Z');
const broken = (id: string) => account({ id, status: 'needs_reconnect' });

function setup(list: StoredAccount[], o: Parameters<typeof memoryAlertStore>[0] = {}, push: AlertDeps['push'] = vi.fn(async () => 201)) {
  const mem = memoryAlertStore({ subs: [pushSub(1)], ...o });
  const sync = memoryStore({ states: list.map((a) => ({ ...emptyState(a.id), lastSuccessAt: '2026-10-13T00:00:00.000Z' })) });
  const deps: AlertDeps = { store: mem.store, push };
  const ctx: AlertRunContext = { accounts: fakeAccounts(list).accounts, sync: sync.store, now: new Date(T0), tz: 'UTC', deadline: T0 + 10_000, clock: () => T0 };
  return { mem, deps, ctx, push };
}

describe('runAlerts', () => {
  it('stores a new alert and pushes it to every subscription, in the owner language', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1')], { subs: [pushSub(1), pushSub(2)], locale: 'zh-CN' });
    expect(await runAlerts(deps, ctx)).toEqual({ created: 1, pushed: 2, failed: 0 });
    expect(mem.rows.map((r) => r.dedupeKey)).toEqual(['needs_reconnect:a1:2026-10-13T00:00:00.000Z']);
    const payload = JSON.parse((push as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(payload).toEqual({ title: '需要重新连接', body: expect.stringContaining('@user_a1'), url: '/accounts', tag: 'needs_reconnect:a1' });
  });

  it("push text uses the owner's number format", async () => {
    const { deps, ctx, push } = setup([], { prefs: { numberFormat: '1.234,5' } });
    vi.mocked(deps.store.insertNew).mockResolvedValue([{ kind: 'reach_drop', accountId: 'a1', severity: 'warning', dedupeKey: 'k', payload: { username: 'cafe', pct: 25.5 } }]);
    await runAlerts(deps, ctx);
    expect(JSON.parse((push as ReturnType<typeof vi.fn>).mock.calls[0][1] as string).body).toContain('25,5%');
  });

  it('the next tick finds the same alert and does nothing (dedupe)', async () => {
    const { deps, ctx, push } = setup([broken('a1')]);
    await runAlerts(deps, ctx);
    expect(await runAlerts(deps, ctx)).toEqual({ created: 0, pushed: 0, failed: 0 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('two overlapping runs push each alert once', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1'), broken('a2')]);
    const [x, y] = await Promise.all([runAlerts(deps, ctx), runAlerts(deps, ctx)]);
    expect(x.created + y.created).toBe(2);
    expect(mem.rows).toHaveLength(2);
    expect(push).toHaveBeenCalledTimes(2); // one per alert, one subscription
  });

  it('push off for a type: stored, not pushed', async () => {
    const { deps, ctx, mem, push } = setup([broken('a1')], { settings: { ...DEFAULT_ALERT_SETTINGS, push: { ...DEFAULT_ALERT_SETTINGS.push, needs_reconnect: false } } });
    expect(await runAlerts(deps, ctx)).toEqual({ created: 1, pushed: 0, failed: 0 });
    expect(mem.rows).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    expect(mem.store.subscriptions).not.toHaveBeenCalled();
  });

  it('no VAPID configured: alerts are still created in-app', async () => {
    const { deps, ctx, mem } = setup([broken('a1')], {}, null);
    expect(await runAlerts(deps, ctx)).toEqual({ created: 1, pushed: 0, failed: 0 });
    expect(mem.rows).toHaveLength(1);
  });

  it('one account failing to load never stops the others', async () => {
    const { deps, ctx, mem } = setup([broken('a1'), broken('a2')]);
    vi.mocked(mem.store.daily).mockImplementation(async (id) => {
      if (id === 'a1') throw new Error('alert store: daily failed');
      return [];
    });
    expect(await runAlerts(deps, ctx)).toEqual({ created: 1, pushed: 1, failed: 1 });
    expect(mem.rows.map((r) => r.accountId)).toEqual(['a2']);
  });

  it('a push failure never fails the run; a 410 subscription is pruned and skipped for the next alert', async () => {
    const push = vi.fn(async (s: { endpoint: string }) => (s.endpoint.endsWith('/1') ? 410 : 500));
    const { deps, ctx, mem } = setup([broken('a1'), broken('a2')], { subs: [pushSub(1), pushSub(2)] }, push);
    expect(await runAlerts(deps, ctx)).toEqual({ created: 2, pushed: 0, failed: 2 });
    expect(mem.subs().map((s) => s.endpoint)).toEqual(['https://push.example/2']);
    expect(push.mock.calls.filter(([s]) => s.endpoint.endsWith('/1'))).toHaveLength(1);
  });

  it('archived accounts are skipped; a manual run evaluates only its account', async () => {
    const list = [broken('a1'), account({ id: 'a2', status: 'archived' }), broken('a3')];
    const { deps, ctx, mem } = setup(list);
    await runAlerts(deps, { ...ctx, accountId: 'a3' });
    expect(mem.rows.map((r) => r.accountId)).toEqual(['a3']);
    await runAlerts(deps, ctx);
    expect(mem.rows.map((r) => r.accountId).sort()).toEqual(['a1', 'a3']);
  });

  it('out of time: stops evaluating and pushing', async () => {
    const { deps, ctx, mem } = setup([broken('a1')]);
    expect(await runAlerts(deps, { ...ctx, deadline: T0 })).toEqual({ created: 0, pushed: 0, failed: 0 });
    expect(mem.store.daily).not.toHaveBeenCalled();
  });

  it('a failing context or insert is counted, never thrown; the summary holds no endpoints or keys', async () => {
    const a = setup([broken('a1')]);
    vi.mocked(a.mem.store.context).mockRejectedValue(new Error('down'));
    expect(await runAlerts(a.deps, a.ctx)).toEqual({ created: 0, pushed: 0, failed: 1 });
    const b = setup([broken('a1')]);
    vi.mocked(b.mem.store.insertNew).mockRejectedValue(new Error('down'));
    const s = await runAlerts(b.deps, b.ctx);
    expect(s).toEqual({ created: 0, pushed: 0, failed: 1 });
    expect(JSON.stringify(s)).not.toMatch(/https:|p256dh|auth/);
  });
});
