// Optional per-media metrics (lib/instagram/metrics.ts EXTRA_GROUPS): one SEPARATE, non-fatal call per metric group,
// always after the core snapshot is stored. A group Meta calls "unsupported" is remembered (capability memory) and not
// asked again; a per-run call budget keeps extras from eating the tick. Only auth / rate-limit errors propagate.
import { isFatalIgError, type IgData, type MediaExtras } from '@/lib/instagram/data';
import { EXTRA_GROUPS, type ExtraScope } from '@/lib/instagram/metrics';
import { learn, shouldAsk, type Capabilities } from '@/lib/sync/capabilities';

/** Extra calls one account run may spend (Stories and posts together; ~0.4 s each). */
export const EXTRA_CALLS_PER_RUN = 20;

/** Mutable per-run state: the learned map is saved with the sync state; the budget counts down. */
export interface ExtrasRun {
  capabilities: Capabilities;
  extraCalls: number;
}

export const scopeOf = (kind: string): ExtraScope => (kind === 'STORY' ? 'story' : kind === 'REELS' ? 'reels' : 'feed');

export async function fetchExtras(ig: IgData, token: string, mediaId: string, scope: ExtraScope, run: ExtrasRun, timeUp: () => boolean): Promise<Partial<MediaExtras>> {
  const out: Record<string, unknown> = {};
  for (const g of EXTRA_GROUPS[scope]) {
    const key = `${scope}:${g.key}`;
    if (!shouldAsk(run.capabilities, key)) continue;
    if (run.extraCalls <= 0 || timeUp()) break;
    run.extraCalls -= 1;
    let values: Record<string, number>;
    try {
      values = await ig.extraInsights(token, mediaId, Object.keys(g.metrics), g.breakdown);
    } catch (e) {
      if (isFatalIgError(e)) throw e;
      run.capabilities = learn(run.capabilities, key, { error: e }); // false only for "unsupported"; anything else: skip
      continue;
    }
    run.capabilities = learn(run.capabilities, key, { ok: true });
    if (g.breakdown) {
      if (Object.keys(values).length > 0) out[Object.values(g.metrics)[0]] = values;
    } else {
      for (const [metric, field] of Object.entries(g.metrics)) if (values[metric] !== undefined) out[field] = values[metric];
    }
  }
  return out as Partial<MediaExtras>;
}
