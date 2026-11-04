import { TagsView } from '@/components/tags/TagsView';
import { addTagRuleAction, applyTagRulesAction, createTagAction, deleteTagAction, deleteTagRuleAction, previewTagRulesAction, renameTagAction } from '@/app/(app)/tags/actions';
import { requireOwner } from '@/lib/auth/require-owner';
import { loadAccounts } from '@/lib/dashboard/cached';
import { buildTagStats } from '@/lib/dashboard/content';
import { loadPostRows, loadTags } from '@/lib/dashboard/detail-read';
import { createServerSupabase } from '@/lib/supabase/server';
import { loadRules } from '@/lib/tag-rules/apply';

export default async function TagsPage() {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const db = await createServerSupabase(); // owner session: RLS applies, never the admin client
  // the tag list does not need the accounts: start it alongside them
  const [all, tags, rules] = await Promise.all([loadAccounts(), loadTags(db), loadRules(db)]);
  const posts = await Promise.all(all.filter((a) => a.status !== 'archived').map((a) => loadPostRows(db, a.id)));
  // imported server actions are passed straight through to the client view
  const ruleActions = { add: addTagRuleAction, remove: deleteTagRuleAction, preview: previewTagRulesAction, apply: applyTagRulesAction };
  return <TagsView tags={tags} stats={buildTagStats(posts.flat(), tags)} create={createTagAction} rename={renameTagAction} remove={deleteTagAction} rules={rules} ruleActions={ruleActions} />;
}
