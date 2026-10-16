// One scheduler tick: pick due work per account (round-robin, oldest attempt first), lease each account, run it within
// the time budget, persist state, evaluate alerts, record a summary. One account failing (bad token, DB hiccup) never
// stops the others.
import type { AccountsStore } from '@/lib/accounts/types';
import { ALERT_BUDGET_MS, runAlerts, type AlertDeps, type AlertRunSummary } from '@/lib/alerts/run';
import type { IgData } from '@/lib/instagram/data';
import { runAccount, type AccountOutcome, type SyncErrorKey } from '@/lib/sync/run-account';
import { byOldestAttempt, dueJobs, type JobKind } from '@/lib/sync/schedule';
import type { SyncStore } from '@/lib/sync/store';

/** Route maxDuration is 60s. Work stops at 35s: a call started just before the deadline can take its 10s timeout (twice for
 *  the two-call jobs) and the state write still has to fit. */
export const TICK_BUDGET_MS = 35_000;
/** Don't start an account with less than this left: a half-started account only wastes calls. */
const MIN_ACCOUNT_MS = 5_000;
/** Longer than any invocation can live, so a crashed tick's lease expires well before the next tick. */
export const LEASE_MS = 120_000;

export interface TickDeps {
  store: SyncStore;
  accounts: AccountsStore;
  ig: IgData;
  alerts?: AlertDeps; // omitted: no alert evaluation (tests of the sync itself)
  clock?: () => number;
  newId?: () => string;
}

interface TickAccount {
  accountId: string;
  outcome: AccountOutcome | 'locked' | 'idle';
  jobs: JobKind[];
  errorKey?: SyncErrorKey;
}

export interface TickSummary {
  trigger: 'cron' | 'manual';
  startedAt: string;
  durationMs: number;
  stoppedEarly: boolean; // time budget or app-wide rate limit left due work for the next tick
  more: boolean; // due work remains because of the TIME BUDGET (not a Meta rate limit): worth an immediate follow-up pass
  accounts: TickAccount[];
  alerts?: AlertRunSummary; // counts only
}

export async function runTick(deps: TickDeps, opts: { trigger: 'cron' | 'manual'; budgetMs?: number; accountId?: string }): Promise<TickSummary> {
  const clock = deps.clock ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const start = clock();
  const deadline = start + (opts.budgetMs ?? TICK_BUDGET_MS);
  const startedAt = new Date(start).toISOString();
  const manual = opts.trigger === 'manual';
  const out: TickAccount[] = [];
  let stoppedEarly = false;
  let budgetStop = false; // ran out of time with work left (a continuation pass is useful)
  let appLimited = false; // Meta throttled the whole app (a continuation would only make it worse)

  const tz = await deps.store.ownerTimezone();
  const active = (await deps.accounts.list()).filter((a) => a.status === 'active' && (!opts.accountId || a.id === opts.accountId));
  const states = await deps.store.loadStates(active.map((a) => a.id));
  const ordered = [...active].sort((a, b) => byOldestAttempt(states.get(a.id)!, states.get(b.id)!));

  for (const account of ordered) {
    if (deadline - clock() < MIN_ACCOUNT_MS) {
      budgetStop = true;
      stoppedEarly = true;
      break;
    }
    const now = new Date(clock());
    const state = states.get(account.id)!;
    if (dueJobs({ status: account.status, tokenExpiresAt: account.tokenExpiresAt, state }, now, tz, { manual }).length === 0) {
      out.push({ accountId: account.id, outcome: state.leaseUntil && Date.parse(state.leaseUntil) > now.getTime() ? 'locked' : 'idle', jobs: [] });
      continue;
    }
    const leaseId = newId();
    try {
      const claimed = await deps.store.claimLease(account.id, leaseId, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString());
      if (!claimed) {
        out.push({ accountId: account.id, outcome: 'locked', jobs: [] });
        continue;
      }
      // The snapshot above can be stale (a double-fired tick may have just finished this account): plan from the claimed row.
      // Its last_attempt_at is our own claim stamp and must not count for back-off; the lease is ours, not "another tick's".
      const fresh = { ...claimed, lastAttemptAt: state.lastAttemptAt, leaseUntil: null };
      const jobs = dueJobs({ status: account.status, tokenExpiresAt: account.tokenExpiresAt, state: fresh }, now, tz, { manual });
      if (jobs.length === 0) {
        await deps.store.saveState(account.id, leaseId, { lastAttemptAt: now.toISOString(), consecutiveFailures: fresh.consecutiveFailures, lastErrorKey: fresh.lastErrorKey, dailyDoneThrough: fresh.dailyDoneThrough, lastRun: fresh.lastRun });
        out.push({ accountId: account.id, outcome: 'idle', jobs: [] });
        continue;
      }
      const token = await deps.store.getToken(account.id);
      if (!token) {
        // connected without a stored token: nothing can be fetched until the owner reconnects
        await deps.accounts.update(account.id, { status: 'needs_reconnect', lastError: 'token_missing' });
        await deps.store.saveState(account.id, leaseId, { lastAttemptAt: now.toISOString(), consecutiveFailures: fresh.consecutiveFailures + 1, lastErrorKey: 'token_invalid', dailyDoneThrough: fresh.dailyDoneThrough, lastRun: fresh.lastRun });
        out.push({ accountId: account.id, outcome: 'needs_reconnect', jobs: [], errorKey: 'token_invalid' });
        continue;
      }
      const { result, patch } = await runAccount({ ig: deps.ig, store: deps.store, accounts: deps.accounts, account, token, state: fresh, tz, now, deadline, clock }, jobs);
      await deps.store.saveState(account.id, leaseId, patch);
      out.push({ accountId: account.id, outcome: result.outcome, jobs: result.jobs, ...(result.errorKey ? { errorKey: result.errorKey } : {}) });
      if (result.outcome === 'partial') {
        stoppedEarly = true;
        budgetStop = true;
      }
      if (result.appRateLimited) {
        appLimited = true;
        stoppedEarly = true;
        break; // app-wide throttle: every further call would fail too
      }
    } catch {
      // store failure outside runAccount (lease, token read, state write). The lease expires by itself (LEASE_MS).
      out.push({ accountId: account.id, outcome: 'failed', jobs: [], errorKey: 'unexpected' });
    }
  }

  // SPEC §6: rules run after the account jobs. runAlerts never throws; the catch is a second net for the tick.
  const alerts = deps.alerts
    ? await runAlerts(deps.alerts, { accounts: deps.accounts, sync: deps.store, now: new Date(clock()), tz, deadline: deadline + ALERT_BUDGET_MS, clock, accountId: opts.accountId }).catch(() => ({ created: 0, pushed: 0, failed: 1 }))
    : undefined;
  const summary: TickSummary = { trigger: opts.trigger, startedAt, durationMs: clock() - start, stoppedEarly, more: budgetStop && !appLimited, accounts: out, ...(alerts ? { alerts } : {}) };
  await deps.store.recordRun({ startedAt, finishedAt: new Date(clock()).toISOString(), trigger: opts.trigger, summary }).catch(() => {});
  return summary;
}
