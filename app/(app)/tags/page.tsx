import { TagsView } from '@/components/tags/TagsView';
import { createTagAction, deleteTagAction, renameTagAction } from '@/app/(app)/tags/actions';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { requireOwner } from '@/lib/auth/require-owner';
import { buildTagStats } from '@/lib/dashboard/content';
import { loadPostRows, loadTags } from '@/lib/dashboard/detail-read';
import { createServerSupabase } from '@/lib/supabase/server';

export default async function TagsPage() {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  const accounts = (await supabaseAccountsStore(db).list()).filter((a) => a.status !== 'archived');
  const [tags, posts] = await Promise.all([loadTags(db), Promise.all(accounts.map((a) => loadPostRows(db, a.id)))]);
  // imported server actions are passed straight through to the client view
  return <TagsView tags={tags} stats={buildTagStats(posts.flat(), tags)} create={createTagAction} rename={renameTagAction} remove={deleteTagAction} />;
}
