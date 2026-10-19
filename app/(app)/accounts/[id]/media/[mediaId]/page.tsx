import { notFound } from 'next/navigation';
import { setPostTagsAction } from '@/app/(app)/tags/actions';
import { PostLabUnavailable, PostLabView } from '@/components/post-lab/PostLabView';
import { buildPostLab } from '@/lib/analysis/post-lab';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts } from '@/lib/dashboard/cached';
import { loadTags } from '@/lib/dashboard/detail-read';
import { backHref, parseLabParams } from '@/lib/post-lab/params';
import { loadPostLab } from '@/lib/post-lab/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { isMediaId, isUuid } from '@/lib/tags';

type SearchParams = Record<string, string | string[] | undefined>;

/** Post Lab: one post, Reel, carousel or Story of one live account (creator-toolkit design §5). Wiring only. */
export default async function PostLabPage({ params, searchParams }: { params: Promise<{ id: string; mediaId: string }>; searchParams: Promise<SearchParams> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const { id, mediaId } = await params;
  if (!isUuid(id) || !isMediaId(mediaId)) notFound();
  const [sp, accounts, prefs] = await Promise.all([searchParams, loadAccounts(), getPrefs()]);
  const account = accounts.find((a) => a.id === id.toLowerCase() && a.status !== 'archived'); // archived accounts are hidden (SPEC §7c)
  if (!account) notFound();
  const lab = parseLabParams(sp, prefs.weekStart);
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const [read, tags] = await Promise.all([loadPostLab(db, account.id, mediaId, prefs.timezone), loadTags(db)]);
  if (read.kind === 'not_found') notFound(); // includes another account's media id
  if (read.kind === 'needs_migration') return <PostLabUnavailable back={backHref(account.id, false, lab)} />;
  const model = buildPostLab(read.input, { now: new Date(), tz: prefs.timezone, peers: lab.peers, er: lab.er });
  // the imported server action is passed straight to the client component (never wrapped in a closure here)
  return <PostLabView model={model} account={{ id: account.id, username: account.username }} tags={tags} params={lab} setPostTags={setPostTagsAction} />;
}
