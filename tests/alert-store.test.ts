import { describe, expect, it } from 'vitest';
import type { Alert } from '@/lib/alerts/rules';
import { DEFAULT_ALERT_SETTINGS } from '@/lib/alerts/settings';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { supabaseAlertStore } from '@/lib/alerts/store';

type Call = { table: string; op: string; args: unknown[]; filters: unknown[][] };

/** Records every query-builder call; each awaited query resolves to the next queued result (default: ok, no data). */
function recorder(results: { data?: unknown; error?: unknown }[] = []) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, op: '', args: [], filters: [] };
      calls.push(call);
      const next = () => Promise.resolve(results.shift() ?? { data: null, error: null });
      const chain: Record<string, unknown> = {};
      for (const op of ['insert', 'update', 'upsert', 'delete']) chain[op] = (...a: unknown[]) => ((call.op = op), call.args.push(...a), chain);
      chain.select = (...a: unknown[]) => ((call.op ||= 'select'), call.args.push(...a), chain);
      for (const f of ['eq', 'neq', 'in', 'is', 'or', 'gte', 'order', 'limit', 'range']) chain[f] = (...a: unknown[]) => (call.filters.push([f, ...a]), chain);
      chain.maybeSingle = next;
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => next().then(res, rej);
      return chain;
    },
  };
  return { db: db as never, calls };
}

const alert = (key: string): Alert => ({ kind: 'needs_reconnect', accountId: 'a1', severity: 'critical', dedupeKey: key, payload: { username: 'cafe' } });

describe('supabaseAlertStore', () => {
  it('context: owner settings parsed, language validated; no owner or junk gives defaults', async () => {
    const row = { alert_settings: { reachDropPct: 30, junk: 1 }, language: 'zh-CN', timezone: 'Europe/Berlin', date_format: 'DD/MM/YYYY', time_format: '12h', number_format: '1.234,5', week_start: 'sun' };
    const r = recorder([{ data: { user_id: 'u1' } }, { data: row }]);
    expect(await supabaseAlertStore(r.db).context()).toEqual({
      settings: { ...DEFAULT_ALERT_SETTINGS, reachDropPct: 30 },
      prefs: { ...DEFAULT_PREFS, locale: 'zh-CN', timezone: 'Europe/Berlin', dateFormat: 'DD/MM/YYYY', timeFormat: '12h', numberFormat: '1.234,5', weekStart: 'sun' },
    });
    expect(r.calls[1]).toMatchObject({ table: 'profiles', args: ['alert_settings,language,timezone,date_format,time_format,number_format,week_start'], filters: [['eq', 'user_id', 'u1']] });
    expect(await supabaseAlertStore(recorder([{ data: null }]).db).context()).toEqual({ settings: DEFAULT_ALERT_SETTINGS, prefs: DEFAULT_PREFS });
    expect(await supabaseAlertStore(recorder([{ data: { user_id: 'u1' } }, { data: { alert_settings: 'x', language: 'fr', number_format: 'bogus' } }]).db).context()).toEqual({ settings: DEFAULT_ALERT_SETTINGS, prefs: DEFAULT_PREFS });
  });

  it('a database error throws a fixed message (never the Supabase text)', async () => {
    const r = recorder([{ error: { message: 'secret detail' } }]);
    await expect(supabaseAlertStore(r.db).context()).rejects.toThrow('alert store: context failed');
  });

  it('insertNew: one ON CONFLICT DO NOTHING insert; returns only the rows Postgres really inserted', async () => {
    const r = recorder([{ data: [{ dedupe_key: 'k2' }] }]);
    const out = await supabaseAlertStore(r.db).insertNew([alert('k1'), alert('k2')]);
    expect(out.map((a) => a.dedupeKey)).toEqual(['k2']);
    expect(r.calls[0]).toMatchObject({
      table: 'notifications',
      op: 'upsert',
      args: [[{ account_id: 'a1', kind: 'needs_reconnect', severity: 'critical', payload: { username: 'cafe' }, dedupe_key: 'k1' }, expect.objectContaining({ dedupe_key: 'k2' })], { onConflict: 'dedupe_key', ignoreDuplicates: true }, 'dedupe_key'],
    });
    expect(await supabaseAlertStore(recorder().db).insertNew([])).toEqual([]);
  });

  it('lastReachDropAt: newest reach_drop for the account', async () => {
    const r = recorder([{ data: { created_at: '2026-10-10T00:00:00Z' } }]);
    expect(await supabaseAlertStore(r.db).lastReachDropAt('a1')).toBe('2026-10-10T00:00:00Z');
    expect(r.calls[0].filters).toEqual([['eq', 'account_id', 'a1'], ['eq', 'kind', 'reach_drop'], ['order', 'created_at', { ascending: false }], ['limit', 1]]);
    expect(await supabaseAlertStore(recorder([{ data: null }]).db).lastReachDropAt('a1')).toBeNull();
  });

  it('subscriptions: explicit columns, malformed rows dropped; deleteSubscription by endpoint', async () => {
    const r = recorder([{ data: [{ endpoint: 'https://p/1', keys: { p256dh: 'P', auth: 'A' } }, { endpoint: 'https://p/2', keys: null }, { endpoint: null, keys: { p256dh: 'P', auth: 'A' } }] }]);
    expect(await supabaseAlertStore(r.db).subscriptions()).toEqual([{ endpoint: 'https://p/1', keys: { p256dh: 'P', auth: 'A' } }]);
    expect(r.calls[0].args).toEqual(['endpoint,keys']);
    const d = recorder();
    await supabaseAlertStore(d.db).deleteSubscription('https://p/1');
    expect(d.calls[0]).toMatchObject({ table: 'push_subscriptions', op: 'delete', filters: [['eq', 'endpoint', 'https://p/1']] });
  });

  it('daily and posts reuse the dashboard readers (explicit columns, capped)', async () => {
    const r = recorder([{ data: [] }, { data: [] }]);
    const s = supabaseAlertStore(r.db);
    await s.daily('a1', '2026-09-30');
    await s.posts('a1');
    expect(r.calls.map((c) => c.table)).toEqual(['account_daily', 'media']);
    expect(r.calls[1].filters).toContainEqual(['range', 0, 59]); // ALERT_POSTS newest, one page
  });
});
