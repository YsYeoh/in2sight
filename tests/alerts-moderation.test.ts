// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { alertHref } from '@/lib/alerts/message';
import { pushMessage } from '@/lib/alerts/push-message';
import { evaluateRules, type RuleInput } from '@/lib/alerts/rules';
import { runAlerts } from '@/lib/alerts/run';
import { ALERT_KINDS, DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';
import { supabaseAlertStore } from '@/lib/alerts/store';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { memoryAlertStore } from './fixtures/alert-fakes';
import { account, fakeAccounts } from './fixtures/sync-fakes';

const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const AT = '2026-10-14T01:30:00.000Z';
const NOW = new Date('2026-10-14T02:00:00Z');
const input = (o: Partial<RuleInput> = {}): RuleInput => ({
  account: { id: A, username: 'cafe', status: 'active', tokenExpiresAt: null },
  sync: { consecutiveFailures: 0, lastSuccessAt: null },
  daily: [],
  posts: [],
  lastReachDropAt: null,
  settings: DEFAULT_ALERT_SETTINGS,
  now: NOW,
  tz: 'Asia/Kuala_Lumpur',
  ...o,
});

describe('moderation_paused alert', () => {
  it('is a known kind, pushed by default, kept by the settings parser', () => {
    expect(ALERT_KINDS.at(-1)).toBe('moderation_paused');
    expect(DEFAULT_ALERT_SETTINGS.push.moderation_paused).toBe(true);
    expect(parseAlertSettings({ push: { moderation_paused: false } }).push.moderation_paused).toBe(false);
  });

  it('one warning per pause: the dedupe key carries the pause time; payload = the account name only', () => {
    expect(evaluateRules(input({ moderationPausedAt: AT })).filter((a) => a.kind === 'moderation_paused')).toEqual([
      { kind: 'moderation_paused', accountId: A, severity: 'warning', dedupeKey: `moderation_paused:${A}:${AT}`, payload: { username: 'cafe' } },
    ]);
    expect(evaluateRules(input({ moderationPausedAt: null })).some((a) => a.kind === 'moderation_paused')).toBe(false);
    expect(evaluateRules(input()).some((a) => a.kind === 'moderation_paused')).toBe(false);
    expect(evaluateRules(input({ moderationPausedAt: AT, account: { id: A, username: 'cafe', status: 'archived', tokenExpiresAt: null } }))).toEqual([]);
  });

  it('runAlerts reads the pause per account; a store without the method (older fakes) simply has none', async () => {
    const mem = memoryAlertStore();
    const ctx = { accounts: fakeAccounts([account({ id: A, username: 'cafe' })]).accounts, sync: { loadStates: async () => new Map() }, now: NOW, tz: 'UTC', deadline: Infinity, clock: () => NOW.getTime() };
    await runAlerts({ store: { ...mem.store, moderationPausedAt: vi.fn(async () => AT) }, push: null }, ctx);
    expect(mem.rows.map((r) => r.dedupeKey)).toContain(`moderation_paused:${A}:${AT}`);
    const plain = memoryAlertStore();
    await expect(runAlerts({ store: plain.store, push: null }, ctx)).resolves.toMatchObject({ failed: 0 });
    expect(plain.rows.some((r) => r.kind === 'moderation_paused')).toBe(false);
  });

  it('the store reads paused_at of an enabled account; null before the migration; a fixed error otherwise', async () => {
    const calls: unknown[][] = [];
    const db = (res: { data: unknown; error: { code?: string } | null }) =>
      ({
        from: (t: string) => {
          calls.push(['from', t]);
          const chain: Record<string, unknown> = {};
          for (const op of ['select', 'eq', 'not', 'maybeSingle']) chain[op] = (...a: unknown[]) => (calls.push([op, ...a]), chain);
          chain.then = (r: (v: unknown) => unknown) => Promise.resolve(res).then(r);
          return chain;
        },
      }) as unknown as SupabaseClient;
    expect(await supabaseAlertStore(db({ data: { paused_at: AT }, error: null })).moderationPausedAt!(A)).toBe(AT);
    expect(calls).toContainEqual(['from', 'moderation_settings']);
    expect(calls).toContainEqual(['eq', 'auto_hide', true]);
    expect(calls).toContainEqual(['not', 'paused_at', 'is', null]);
    expect(await supabaseAlertStore(db({ data: null, error: { code: 'PGRST205' } })).moderationPausedAt!(A)).toBeNull();
    await expect(supabaseAlertStore(db({ data: null, error: { code: 'XX000' } })).moderationPausedAt!(A)).rejects.toThrow('alert store: moderationPausedAt failed');
  });

  it('opens the Moderation tab; the text names the account and nothing else', () => {
    expect(alertHref('moderation_paused', A)).toBe(`/accounts/${A}?tab=moderation`);
    const m = pushMessage({ kind: 'moderation_paused', accountId: A, payload: { username: 'cafe' } }, { ...DEFAULT_PREFS, locale: 'en' });
    expect(m.title).toBe('Auto-hide paused');
    expect(m.body).toContain('@cafe');
    expect(m.url).toBe(`/accounts/${A}?tab=moderation`);
  });
});
