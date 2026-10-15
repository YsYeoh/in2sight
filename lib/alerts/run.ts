// Runs after the account jobs of every tick (SPEC §6): evaluate the rules per account, store new alerts once, push the
// new ones. Never throws. One account's failure (bad data, DB hiccup) is counted and the others carry on; push failures
// are isolated per device. The summary holds counts only - never endpoints, keys, tokens or error objects.
import type { AccountsStore } from '@/lib/accounts/types';
import { pushMessage } from '@/lib/alerts/push-message';
import { evaluateRules, type Alert } from '@/lib/alerts/rules';
import type { AlertStore } from '@/lib/alerts/store';
import { sendToAll, type PushTransport } from '@/lib/push/send';
import type { SyncStore } from '@/lib/sync/store';
import { addDays, localDay } from '@/lib/sync/time';

/** Alerts get this long after the sync budget (route maxDuration 60 s, sync stops at 35 s). */
export const ALERT_BUDGET_MS = 10_000;
/** Two 7-day windows + Instagram's up-to-3-day lag, with margin. */
const DAILY_DAYS = 20;

export interface AlertDeps {
  store: AlertStore;
  push: PushTransport | null; // null: VAPID not configured, alerts stay in-app
}

export interface AlertRunSummary {
  created: number;
  pushed: number;
  failed: number; // accounts that could not be evaluated + pushes that failed + a failed insert
}

export interface AlertRunContext {
  accounts: AccountsStore;
  sync: Pick<SyncStore, 'loadStates'>;
  now: Date;
  tz: string;
  deadline: number; // ms epoch
  clock: () => number;
  accountId?: string; // manual "Sync now" for one account: evaluate only that one
}

export async function runAlerts(deps: AlertDeps, c: AlertRunContext): Promise<AlertRunSummary> {
  const out: AlertRunSummary = { created: 0, pushed: 0, failed: 0 };
  try {
    const { settings, locale } = await deps.store.context();
    // fresh reads: an account flipped to needs_reconnect (or a failure streak grown) during this tick must alert now
    const accounts = (await c.accounts.list()).filter((a) => a.status !== 'archived' && (!c.accountId || a.id === c.accountId));
    const states = await c.sync.loadStates(accounts.map((a) => a.id));
    const fromDay = addDays(localDay(c.now, c.tz), -DAILY_DAYS);

    const found: Alert[] = [];
    for (const a of accounts) {
      if (c.clock() >= c.deadline) break;
      try {
        const [daily, posts, lastReachDropAt] = await Promise.all([deps.store.daily(a.id, fromDay), deps.store.posts(a.id), deps.store.lastReachDropAt(a.id)]);
        const s = states.get(a.id);
        found.push(...evaluateRules({ account: a, sync: { consecutiveFailures: s?.consecutiveFailures ?? 0, lastSuccessAt: s?.lastSuccessAt ?? null }, daily, posts, lastReachDropAt, settings, now: c.now, tz: c.tz }));
      } catch {
        out.failed++;
      }
    }

    const fresh = await deps.store.insertNew(found);
    out.created = fresh.length;
    const toPush = fresh.filter((a) => settings.push[a.kind]);
    if (!deps.push || toPush.length === 0) return out;

    let subs = await deps.store.subscriptions();
    for (const a of toPush) {
      if (subs.length === 0 || c.clock() >= c.deadline) break;
      const gone = new Set<string>();
      const r = await sendToAll(subs, pushMessage(a, locale), deps.push, async (endpoint) => {
        gone.add(endpoint);
        await deps.store.deleteSubscription(endpoint);
      });
      out.pushed += r.sent;
      out.failed += r.failed;
      subs = subs.filter((s) => !gone.has(s.endpoint));
    }
  } catch {
    out.failed++;
  }
  return out;
}
