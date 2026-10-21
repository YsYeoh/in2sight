import type { NextRequest } from 'next/server';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { assertOwner } from '@/lib/auth/assert-owner';
import { buildFollowerSheets } from '@/lib/export/followers';
import { contentDisposition } from '@/lib/export/filename';
import { exportError, exportFile, exportHeaders } from '@/lib/export/request';
import { translator, writeWorkbook } from '@/lib/export/workbook';
import { formatDay } from '@/lib/format';
import { diffSnapshots, filterList, FOLLOWER_LISTS, type FollowerList } from '@/lib/followers/diff';
import { listFollowerSnapshots, loadFollowerSnapshot } from '@/lib/followers/read';
import { parseFollowerState, resolvePair } from '@/lib/followers/state';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isUuid } from '@/lib/tags';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const KEYS = new Set(['account', 'snap', 'vs', 'list', 'q']);

/**
 * GET /api/export/followers?account=<uuid>&snap=<uuid>[&vs=<uuid>]&list=<list>[&q=<search>] — one follower list of the
 * Followers tab as Excel (Plan 15b). Owner session only (assertOwner first; RLS on every read; never the admin
 * client). Only these keys, each once; the snapshots must belong to the live account. The whole filtered list, sorted
 * as on screen. Never logs names or error objects.
 */
export async function GET(request: NextRequest) {
  const h = exportHeaders();
  try {
    if (!(await assertOwner(h))) return exportError(h, 401, 'unauthorized');
    const q = request.nextUrl.searchParams;
    const keys = [...q.keys()];
    if (keys.some((k) => !KEYS.has(k)) || new Set(keys).size !== keys.length) return exportError(h, 400, 'bad_params');
    const [account, snap, vs, list] = [q.get('account'), q.get('snap'), q.get('vs'), q.get('list')];
    if (!isUuid(account) || !isUuid(snap) || (vs !== null && !isUuid(vs)) || !(FOLLOWER_LISTS as readonly (string | null)[]).includes(list)) return exportError(h, 400, 'bad_params');
    const prefs = await getPrefs();
    const db = await createServerSupabase({ responseHeaders: h }); // owner session: RLS applies
    const acct = await supabaseAccountsStore(db).getById(account.toLowerCase());
    if (!acct || acct.status === 'archived') return exportError(h, 404, 'not_found');
    const snapshots = await listFollowerSnapshots(db, acct.id);
    const state = parseFollowerState({ snap, vs: vs ?? undefined, list: list ?? undefined, q: q.get('q') ?? undefined }, snapshots ?? []);
    if (!snapshots || !state.snap || (vs !== null && !state.vs)) return exportError(h, 404, 'not_found');
    const pair = resolvePair(state, snapshots);
    const [newer, older] = await Promise.all([pair.newer && loadFollowerSnapshot(db, acct.id, pair.newer.id), pair.older && loadFollowerSnapshot(db, acct.id, pair.older.id)]);
    if (!pair.newer || !newer) return exportError(h, 404, 'not_found');
    const people = diffSnapshots(newer, older ?? null)[list as FollowerList];
    if (!people) return exportError(h, 400, 'bad_params'); // a list these snapshots cannot answer
    const sheets = buildFollowerSheets(
      { account: acct.username, list: list as FollowerList, newer: formatDay(pair.newer.takenOn, prefs), older: older && pair.older ? formatDay(pair.older.takenOn, prefs) : null, people: filterList(people, state.q) },
      translator(prefs.locale),
      prefs,
    );
    return exportFile(h, await writeWorkbook(sheets), XLSX, contentDisposition(`in2sight-${acct.username}-${list}-${pair.newer.takenOn}`, 'xlsx'));
  } catch {
    console.error('followers export failed'); // fixed text: never the error object (it can carry usernames)
    return exportError(h, 500, 'unexpected');
  }
}
