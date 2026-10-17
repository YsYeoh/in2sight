-- Plan 13b: Post Lab reads. Additive (two functions, nothing else). Apply BEFORE deploying the code that calls them;
-- only the Post Lab route (/accounts/[id]/media/[mediaId]) does, and it shows "needs a database update" without them.
--
-- Both functions are `security invoker`: they run with the caller's rights, so the owner-only RLS policies of media and
-- media_metrics still apply (any other session gets no rows). Execute is revoked from public/anon and granted to
-- `authenticated` only. Inputs are typed arrays (media ids, minutes); nothing is concatenated into SQL. The checkpoint
-- table (marks and tolerances in minutes) is passed in by lib/analysis/post-lab.ts, so it exists in one place only.

-- 1. The latest KNOWN value of every metric column per media (newest non-null value of each column), plus when the
-- newest snapshot was taken and how many there are. Extras of a snapshot can be missing on a busy tick (the per-run
-- extras budget) while the snapshot before has them; a Story's latest values are its final numbers (Stories are only
-- measured while live). Media without any snapshot return no row.
create or replace function public.post_lab_latest(p_ids text[])
returns table (media_id text, captured_at timestamptz, snapshots int, reach int, views int, likes int, comments int, saves int, shares int, total_interactions int, replies int, taps_forward int, taps_back int, exits int, swipe_forward int, follows int, profile_visits int, profile_activity jsonb, avg_watch_ms int, total_watch_ms bigint, skip_rate numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.media_id,
         max(x.captured_at),
         count(*)::int,
         (array_agg(x.reach order by x.captured_at desc) filter (where x.reach is not null))[1],
         (array_agg(x.views order by x.captured_at desc) filter (where x.views is not null))[1],
         (array_agg(x.likes order by x.captured_at desc) filter (where x.likes is not null))[1],
         (array_agg(x.comments order by x.captured_at desc) filter (where x.comments is not null))[1],
         (array_agg(x.saves order by x.captured_at desc) filter (where x.saves is not null))[1],
         (array_agg(x.shares order by x.captured_at desc) filter (where x.shares is not null))[1],
         (array_agg(x.total_interactions order by x.captured_at desc) filter (where x.total_interactions is not null))[1],
         (array_agg(x.replies order by x.captured_at desc) filter (where x.replies is not null))[1],
         (array_agg(x.taps_forward order by x.captured_at desc) filter (where x.taps_forward is not null))[1],
         (array_agg(x.taps_back order by x.captured_at desc) filter (where x.taps_back is not null))[1],
         (array_agg(x.exits order by x.captured_at desc) filter (where x.exits is not null))[1],
         (array_agg(x.swipe_forward order by x.captured_at desc) filter (where x.swipe_forward is not null))[1],
         (array_agg(x.follows order by x.captured_at desc) filter (where x.follows is not null))[1],
         (array_agg(x.profile_visits order by x.captured_at desc) filter (where x.profile_visits is not null))[1],
         (array_agg(x.profile_activity order by x.captured_at desc) filter (where x.profile_activity is not null))[1],
         (array_agg(x.avg_watch_ms order by x.captured_at desc) filter (where x.avg_watch_ms is not null))[1],
         (array_agg(x.total_watch_ms order by x.captured_at desc) filter (where x.total_watch_ms is not null))[1],
         (array_agg(x.skip_rate order by x.captured_at desc) filter (where x.skip_rate is not null))[1]
    from public.media_metrics x
   where x.media_id = any (p_ids)
   group by x.media_id
$$;

-- 2. Velocity checkpoints: per media and mark (minutes after posting), the snapshot NEAREST to posted_at + mark whose
-- age is within the mark's tolerance (p_marks[i] pairs with p_tols[i]); the earlier snapshot wins a tie. No snapshot in
-- the window = no row for that mark (a point is never interpolated). age_min = the snapshot's real age in minutes.
create or replace function public.post_lab_points(p_ids text[], p_marks int[], p_tols int[])
returns table (media_id text, mark int, age_min int, reach int, views int)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (x.media_id, k.mark)
         x.media_id, k.mark, round(extract(epoch from x.captured_at - m.posted_at) / 60)::int, x.reach, x.views
    from public.media m
    join public.media_metrics x on x.media_id = m.id
   cross join unnest(p_marks, p_tols) as k(mark, tol)
   where m.id = any (p_ids)
     and (x.reach is not null or x.views is not null)
     and abs(extract(epoch from x.captured_at - m.posted_at) / 60 - k.mark) <= k.tol
   order by x.media_id, k.mark, abs(extract(epoch from x.captured_at - m.posted_at) / 60 - k.mark), x.captured_at
$$;

revoke execute on function public.post_lab_latest(text[]) from public, anon;
revoke execute on function public.post_lab_points(text[], int[], int[]) from public, anon;
grant execute on function public.post_lab_latest(text[]) to authenticated;
grant execute on function public.post_lab_points(text[], int[], int[]) to authenticated;
