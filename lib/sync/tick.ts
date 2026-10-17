// One scheduler tick in two lanes. Lane 1: the regular jobs (Stories, recent posts, daily refresh, token) of EVERY
// account, round-robin by oldest attempt, each with a small slice. Lane 2: whatever is left (a new account's onboarding,
// the history import, regular jobs a slice cut short), the remaining budget split equally across those accounts. Each
// lane run leases the account, runs within its slice, persists state; then alerts are evaluated and a summary recorded.
// One account failing (bad token, DB hiccup) never stops the others.
import type { AccountsStore, StoredAccount } from '@/lib/accounts/types';
import { ALERT_BUDGET_MS, runAlerts, type AlertDeps, type AlertRunSummary } from '@/lib/alerts/run';
import type { IgData } from '@/lib/instagram/data';
import { progressSink, type ProgressSink } from '@/lib/sync/progress-sink';
import { runAccount, type AccountOutcome, type SyncErrorKey } from '@/lib/sync/run-account';
import { byOldestAttempt, dueJobs, isBackfilling, LANE2_ONLY, type JobKind, type Lane, type ScheduleInput, type SyncState } from '@/lib/sync/schedule';
import type { SyncStore } from '@/lib/sync/store';

/** Route maxDuration is 60s. Work stops at 35s: a call started just before the deadline can take its 10s timeout (twice for
 *  the two-call jobs) and the state write still has to fit. */
export const TICK_BUDGET_MS = 35_000;
/** Don't start an account with less than this left: a half-started account only wastes calls. */
const MIN_ACCOUNT_MS = 5_000;
/** Lane 1 slice per account: enough for Stories + recent posts; whatever does not fit continues in lane 2. */
const REGULAR_SLICE_MS = 8_000;
/** Longer than any invocation can live, so a crashed tick's lease expires well before the next tick. */
export const LEASE_MS = 120_000;

export interface TickDeps {
  store: SyncStore;
  accounts: AccountsStore;
  ig: IgData;
  alerts?: AlertDeps; // omitted: no alert evaluation (tests of the sync itself)
  clock?: () => number;
  newId?: () => string;
  cdnFetch?: typeof fetch; // cover downloads; default global fetch
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

type LaneResult = TickAccount & { appRateLimited?: boolean };

export async function runTick(deps: TickDeps, opts: { trigger: 'cron' | 'manual'; budgetMs?: number; accountId?: string }): Promise<TickSummary> {
  const clock = deps.clock ?? Date.now;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const start = clock();
  const deadline = start + (opts.budgetMs ?? TICK_BUDGET_MS);
  const startedAt = new Date(start).toISOString();
  const manual = opts.trigger === 'manual';
  const out = new Map<string, TickAccount>(); // insertion order = lane 1 order
  let budgetStop = false; // ran out of time with work left (a continuation pass is useful)
  let appLimited = false; // Meta throttled the whole app (a continuation would only make it worse)

  const tz = await deps.store.ownerTimezone();
  const active = (await deps.accounts.list()).filter((a) => a.status === 'active' && (!opts.accountId || a.id === opts.accountId));
  const states = await deps.store.loadStates(active.map((a) => a.id));
  const ordered = [...active].sort((a, b) => byOldestAttempt(states.get(a.id)!, states.get(b.id)!));
  const input = (a: StoredAccount, state: SyncState): ScheduleInput => ({ status: a.status, tokenExpiresAt: a.tokenExpiresAt, state });

  /** One lane for one account: lease, plan from the claimed row, run until sliceEnd, persist, report progress. */
  async function runLane(account: StoredAccount, lane: Lane, sliceEnd: number, skip: readonly JobKind[]): Promise<LaneResult> {
    const id = account.id;
    const now = new Date(clock());
    const state = states.get(id)!;
    const plan = (s: SyncState) => dueJobs(input(account, s), now, tz, { manual, lane }).filter((j) => !skip.includes(j));
    if (plan(state).length === 0) return { accountId: id, outcome: state.leaseUntil && Date.parse(state.leaseUntil) > now.getTime() ? 'locked' : 'idle', jobs: [] };
    const leaseId = newId();
    let progress: ProgressSink | undefined;
    try {
      const claimed = await deps.store.claimLease(id, leaseId, new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString());
      if (!claimed) return { accountId: id, outcome: 'locked', jobs: [] };
      // The snapshot above can be stale (a double-fired tick may have just finished this account): plan from the claimed row.
      // Its last_attempt_at is our own claim stamp and must not count for back-off; the lease is ours, not "another tick's".
      const fresh: SyncState = { ...claimed, lastAttemptAt: state.lastAttemptAt, leaseUntil: null };
      const keep = { lastAttemptAt: now.toISOString(), dailyDoneThrough: fresh.dailyDoneThrough, backfilledFrom: fresh.backfilledFrom, lastRun: fresh.lastRun };
      const jobs = plan(fresh);
      if (jobs.length === 0) {
        await deps.store.saveState(id, leaseId, { ...keep, consecutiveFailures: fresh.consecutiveFailures, lastErrorKey: fresh.lastErrorKey });
        states.set(id, { ...fresh, lastAttemptAt: keep.lastAttemptAt });
        return { accountId: id, outcome: 'idle', jobs: [] };
      }
      const token = await deps.store.getToken(id);
      if (!token) {
        // connected without a stored token: nothing can be fetched until the owner reconnects
        await deps.accounts.update(id, { status: 'needs_reconnect', lastError: 'token_missing' });
        await deps.store.saveState(id, leaseId, { ...keep, consecutiveFailures: fresh.consecutiveFailures + 1, lastErrorKey: 'token_invalid' });
        return { accountId: id, outcome: 'needs_reconnect', jobs: [], errorKey: 'token_invalid' };
      }
      // live progress only while importing or on a manual run: a complete account's 30-minute ticks stay silent
      progress = manual || isBackfilling(fresh) ? progressSink(deps.store, id, clock) : undefined;
      const { result, patch } = await runAccount({ ig: deps.ig, store: deps.store, accounts: deps.accounts, account, token, state: fresh, tz, now, deadline: sliceEnd, clock, progress, cdnFetch: deps.cdnFetch }, jobs);
      await deps.store.saveState(id, leaseId, patch);
      const next: SyncState = { ...fresh, ...patch, lastSuccessAt: patch.lastSuccessAt ?? fresh.lastSuccessAt };
      states.set(id, next);
      if (progress) {
        const failed = result.outcome === 'failed' || result.outcome === 'needs_reconnect';
        await progress.finish(failed ? 'failed' : result.outcome === 'partial' || isBackfilling(next) ? 'waiting' : 'done', result.errorKey ?? null);
      }
      return { accountId: id, outcome: result.outcome, jobs: result.jobs, ...(result.errorKey ? { errorKey: result.errorKey } : {}), ...(result.appRateLimited ? { appRateLimited: true } : {}) };
    } catch {
      // store failure outside runAccount (lease, token read, state write). The lease expires by itself (LEASE_MS).
      await progress?.finish('failed', 'unexpected').catch(() => {}); // else the row stays "running" and the panel shows stalled
      return { accountId: id, outcome: 'failed', jobs: [], errorKey: 'unexpected' };
    }
  }
  const entry = (r: LaneResult): TickAccount => ({ accountId: r.accountId, outcome: r.outcome, jobs: r.jobs, ...(r.errorKey ? { errorKey: r.errorKey } : {}) });

  // Lane 1: regular jobs for every account first, each within a small slice.
  for (const account of ordered) {
    if (deadline - clock() < MIN_ACCOUNT_MS) {
      budgetStop = true;
      break;
    }
    const r = await runLane(account, 'regular', Math.min(deadline, clock() + REGULAR_SLICE_MS), []);
    out.set(account.id, entry(r));
    if (r.appRateLimited) {
      appLimited = true; // app-wide throttle: every further call would fail too, so lane 2 never starts
      break;
    }
  }

  // Lane 2: accounts with work left share the rest equally (re-split after each one, so time a fast one leaves is reused).
  const lane2 = appLimited
    ? []
    : ordered.filter((a) => {
        const e = out.get(a.id);
        if (!e || e.outcome === 'locked' || e.outcome === 'needs_reconnect' || e.outcome === 'failed') return false; // a failed job is not retried in the same pass (+1 failure per tick, errorKey stays)
        const s = states.get(a.id)!;
        const optionalDue = dueJobs(input(a, s), new Date(clock()), tz, { manual }).some((j) => LANE2_ONLY.includes(j)); // covers (+ comments)
        return e.outcome === 'partial' || isBackfilling(s) || optionalDue;
      });
  for (const [i, account] of lane2.entries()) {
    const left = deadline - clock();
    if (left < MIN_ACCOUNT_MS) {
      budgetStop = true;
      break;
    }
    const before = out.get(account.id)!;
    const r = await runLane(account, 'all', Math.min(deadline, clock() + Math.max(MIN_ACCOUNT_MS, left / (lane2.length - i))), before.jobs);
    if (r.outcome !== 'idle' && r.outcome !== 'locked') out.set(account.id, { ...entry(r), jobs: [...before.jobs, ...r.jobs] });
    if (r.outcome === 'partial') budgetStop = true;
    if (r.appRateLimited) {
      appLimited = true;
      break;
    }
  }

  // SPEC §6: rules run after the account jobs. runAlerts never throws; the catch is a second net for the tick.
  const alerts = deps.alerts
    ? await runAlerts(deps.alerts, { accounts: deps.accounts, sync: deps.store, now: new Date(clock()), tz, deadline: deadline + ALERT_BUDGET_MS, clock, accountId: opts.accountId }).catch(() => ({ created: 0, pushed: 0, failed: 1 }))
    : undefined;
  const summary: TickSummary = { trigger: opts.trigger, startedAt, durationMs: clock() - start, stoppedEarly: budgetStop || appLimited, more: budgetStop && !appLimited, accounts: [...out.values()], ...(alerts ? { alerts } : {}) };
  await deps.store.recordRun({ startedAt, finishedAt: new Date(clock()).toISOString(), trigger: opts.trigger, summary }).catch(() => {});
  return summary;
}
