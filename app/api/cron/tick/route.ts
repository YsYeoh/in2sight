import { after, NextResponse, type NextRequest } from 'next/server';
import { EnvError, getServerEnv } from '@/lib/env';
import { isCronAuthorized } from '@/lib/sync/cron-auth';
import { createSyncDeps } from '@/lib/sync/deps';
import { runTick, TICK_BUDGET_MS } from '@/lib/sync/tick';

// Called every 30 minutes by an external scheduler (cron-job.org; pg_cron/pg_net as fallback), never by a browser.
// Answers 202 at once (cron-job.org gives up after ~30s) and does the work in after(), which Vercel keeps alive via
// waitUntil for up to maxDuration. Results land in public.sync_runs, not in the response.
export const maxDuration = 60;

async function handle(request: NextRequest) {
  let deps: ReturnType<typeof createSyncDeps>;
  try {
    const { cronSecret } = getServerEnv();
    // fail closed: no secret configured -> EnvError -> 503 below; wrong or missing header -> 401
    if (!isCronAuthorized(request.headers.get('authorization'), cronSecret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    deps = createSyncDeps();
  } catch (e) {
    if (e instanceof EnvError) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    throw e;
  }
  after(async () => {
    try {
      await runTick(deps, { trigger: 'cron', budgetMs: TICK_BUDGET_MS });
    } catch {
      console.error('sync tick failed'); // fixed text: never log error objects (they could carry request details)
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202, headers: { 'cache-control': 'no-store' } });
}

export { handle as GET, handle as POST };
