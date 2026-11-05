import { getTranslations } from 'next-intl/server';
import { deletePlannerItemAction, movePlannerItemAction, savePlannerItemAction, suggestSlotsAction } from '@/app/(app)/plan/planner-actions';
import { PlannerBoard } from '@/components/plan/PlannerBoard';
import { EmptyState } from '@/components/shared/EmptyState';
import { loadAccounts } from '@/lib/dashboard/cached';
import { loadMonthMedia, loadTags } from '@/lib/dashboard/detail-read';
import { loadPlannerItems } from '@/lib/planner/read';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';
import { addDays, daysToIso, localDay } from '@/lib/sync/time';
import { isUuid } from '@/lib/tags';

/** Days of posts and Stories offered when linking a card to the post it became. */
const LINK_DAYS = 30;

/** The planner board's reads and wiring (Plan 17f). Server component; the caller has run requireOwner(). Rendered as
 *  Plan 17d's `board` section (`/plan/board`) or, without 17d, as the whole `/plan` page. */
export async function PlannerSection({ sp, basePath }: { sp: Record<string, string | string[] | undefined>; basePath: string }) {
  const [prefs, all, db, t] = await Promise.all([getPrefs(), loadAccounts(), createServerSupabase(), getTranslations('planner')]); // owner session: RLS applies
  const accounts = all.filter((a) => a.status !== 'archived').map((a) => ({ id: a.id, username: a.username })); // archived = hidden (SPEC §7c)
  const wanted = isUuid(sp.account) ? sp.account.toLowerCase() : null;
  const account = wanted && accounts.some((a) => a.id === wanted) ? wanted : null; // unknown/archived id → all accounts
  const today = localDay(new Date(), prefs.timezone);
  const { fromIso, toIso } = daysToIso(addDays(today, -LINK_DAYS), today, prefs.timezone);
  const [items, tags, recent] = await Promise.all([
    loadPlannerItems(db),
    loadTags(db),
    accounts.length ? loadMonthMedia(db, accounts.map((a) => a.id), fromIso, toIso) : { media: [], truncated: false },
  ]);
  if (items === null) return <EmptyState title={t('needsUpdate')} />;
  // only what the link list needs; the caption is the owner's own text, cut to an 80-character alt-text snippet
  const media = recent.media.map((m) => ({ id: m.id, accountId: m.accountId, mediaType: m.mediaType, postedAt: m.postedAt, cover: m.cover, slides: m.slides, caption: m.caption === null ? null : [...m.caption].slice(0, 80).join('') }));
  return (
    <PlannerBoard
      items={items}
      accounts={accounts}
      account={account}
      basePath={basePath}
      tags={tags}
      media={media}
      save={savePlannerItemAction}
      move={movePlannerItemAction}
      remove={deletePlannerItemAction}
      suggest={suggestSlotsAction}
    />
  );
}
