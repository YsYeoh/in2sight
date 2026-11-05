// Runs after the account jobs of every tick (SPEC §6): evaluate the rules per account, store new alerts once, push the
// new ones. Never throws. One account's failure (bad data, DB hiccup) is counted and the others carry on; push failures
// are isolated per device. The summary holds counts only - never endpoints, keys, tokens or error objects.
// Plan 17e (SPEC §7c "Smart alerts"): only unusual events are pushed at once and never in quiet hours; the rest goes out
// as ONE morning summary (the weekly review on the week's first day). Every summary row has a dedupe key, so a retried
// or overlapping tick never stores or pushes it twice.
import type { AccountsStore } from '@/lib/accounts/types';
import { pushMessage } from '@/lib/alerts/push-message';
import { digestDue, heldCount, pushNow, summaryAlerts, summaryToPush } from '@/lib/alerts/quiet';
import { evaluateRules, spikeDays, type Alert } from '@/lib/alerts/rules';
import type { AlertStore } from '@/lib/alerts/store';
import { sendToAll, type PushTransport } from '@/lib/push/send';
import type { SyncStore } from '@/lib/sync/store';
import { addDays, localDay } from '@/lib/sync/time';

/** Alerts get this long after the sync budget (route maxDuration 60 s, sync stops at 35 s). */
export const ALERT_BUDGET_MS = 10_000;
/** The spike rules compare a day 2 days back with the same weekday of the 8 weeks before (58 days); reach drop needs
 *  two 7-day windows + Instagram's up-to-3-day lag. 60 rows a day-table read, with margin. */
const DAILY_DAYS = 60;

export interface AlertDeps {
  store: AlertStore;
  push: PushTransport | null; // null: VAPID not configured, alerts stay in-app (and no summaries are made)
}

export interface AlertRunSummary {
  created: number;
  pushed: number;
  failed: number; // accounts that could not be evaluated + pushes that failed + a failed insert or summary
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
    const { settings, prefs } = await deps.store.context();
    // fresh reads: an account flipped to needs_reconnect (or a failure streak grown) during this tick must alert now
    const accounts = (await c.accounts.list()).filter((a) => a.status !== 'archived' && (!c.accountId || a.id === c.accountId));
    const states = await c.sync.loadStates(accounts.map((a) => a.id));
    const today = localDay(c.now, c.tz);
    const fromDay = addDays(today, -DAILY_DAYS);
    const days = spikeDays(today);

    const found: Alert[] = [];
    for (const a of accounts) {
      if (c.clock() >= c.deadline) break;
      try {
        const [daily, posts, lastReachDropAt, moderationPausedAt, reachByFollow] = await Promise.all([deps.store.daily(a.id, fromDay), deps.store.posts(a.id), deps.store.lastReachDropAt(a.id), deps.store.moderationPausedAt?.(a.id) ?? null, deps.store.reachByFollow(a.id, days)]);
        const s = states.get(a.id);
        found.push(...evaluateRules({ account: a, sync: { consecutiveFailures: s?.consecutiveFailures ?? 0, lastSuccessAt: s?.lastSuccessAt ?? null }, daily, posts, lastReachDropAt, moderationPausedAt, reachByFollow, settings, now: c.now, tz: c.tz }));
      } catch {
        out.failed++;
      }
    }

    const fresh = await deps.store.insertNew(found);
    out.created = fresh.length;

    // The morning summary: due once a day after quiet hours. Isolated: a failure here never stops the instant pushes.
    let summaries: Alert[] = [];
    try {
      const due = deps.push && c.clock() < c.deadline ? digestDue(c.now, settings, c.tz) : null;
      const list = due ? summaryAlerts(due.day, settings, prefs.weekStart, heldCount(await deps.store.unreadBetween(due.fromIso, due.toIso), settings, c.tz)) : [];
      if (list.length > 0) summaries = await deps.store.insertNew(list);
    } catch {
      out.failed++;
    }
    out.created += summaries.length;

    const summary = summaryToPush(summaries);
    const toPush = [...fresh.filter((a) => pushNow(a.kind, settings, c.now, c.tz)), ...(summary ? [summary] : [])];
    if (!deps.push || toPush.length === 0) return out;

    let subs = await deps.store.subscriptions();
    for (const a of toPush) {
      if (subs.length === 0 || c.clock() >= c.deadline) break;
      const gone = new Set<string>();
      const r = await sendToAll(subs, pushMessage(a, prefs), deps.push, async (endpoint) => {
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
