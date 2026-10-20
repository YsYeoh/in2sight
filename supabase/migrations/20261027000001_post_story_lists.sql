-- Plan 14b: one page of an account's Posts or Stories, filtered and sorted in the database. Additive (two functions,
-- nothing else). Apply BEFORE deploying the code that calls them; until then the Posts and Stories tabs fall back to
-- their capped reads (docs/RUNBOOK_LISTS.md §0), so the order is safe either way.
--
-- Both functions are `security invoker`: they run with the caller's rights, so the owner-only RLS policies of media,
-- media_metrics, media_tags and tags still apply (any other session gets no rows). Execute is revoked from public/anon
-- and granted to `authenticated` only. Inputs are typed; the text inputs are only compared (p_sort, p_format) or
-- searched with strpos (p_q: no pattern, so % and _ are plain characters), never concatenated into SQL.
-- The SQL decides filter, order and page only. The numbers shown are computed by the TypeScript from the returned
-- columns (lib/analysis/posts.ts engagementRate, lib/dashboard/content.ts storyView); the sort keys below are the same
-- formulas and are pinned by tests/lists-migration.test.ts and tests/lists.test.ts.
-- Rows are numbered 1..total in the chosen order (n); the page is n in (p_offset, p_offset + p_limit]; every row
-- carries the total, so one call returns the page and the count.

-- 1. Feed posts and Reels (no Stories) of one account posted in [p_from, p_to), each with its LATEST snapshot (as the
-- Posts tab shows it). Filters: p_q in the caption or a tag name (case-insensitive), format, tag or untagged (null /
-- false = no filter). Sort p_sort 'date' | 'reach' | 'views' | 'engagement', p_asc = ascending; nulls always last;
-- ties newest first. engagement = (likes + comments + saves + shares) / reach, missing parts as 0, null without reach
-- or when all four parts are missing (= engagementRate in lib/analysis/posts.ts).
create or replace function public.post_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_q text, p_format text, p_tag uuid, p_untagged boolean, p_sort text, p_asc boolean, p_offset int, p_limit int)
returns table (id text, media_type text, posted_at timestamptz, permalink text, caption text, cover_status text, children_count int, reach int, views int, likes int, comments int, saves int, shares int, tag_ids uuid[], n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select m.id, m.media_type, m.posted_at, m.permalink, m.caption, m.cover_status, m.children_count,
           s.reach, s.views, s.likes, s.comments, s.saves, s.shares,
           case when s.reach > 0 and num_nonnulls(s.likes, s.comments, s.saves, s.shares) > 0
                then (coalesce(s.likes, 0) + coalesce(s.comments, 0) + coalesce(s.saves, 0) + coalesce(s.shares, 0))::numeric / s.reach
           end as er
      from public.media m
      left join lateral (
        select x.reach, x.views, x.likes, x.comments, x.saves, x.shares
          from public.media_metrics x
         where x.media_id = m.id
         order by x.captured_at desc
         limit 1
      ) s on true
     where m.account_id = p_account
       and m.media_type <> 'STORY'
       and m.posted_at >= p_from and m.posted_at < p_to
       and (p_format is null or m.media_type = p_format)
       and (p_tag is null or exists (select 1 from public.media_tags t where t.media_id = m.id and t.tag_id = p_tag))
       and (p_untagged is not true or not exists (select 1 from public.media_tags t where t.media_id = m.id))
       and (p_q is null
            or strpos(lower(coalesce(m.caption, '')), lower(p_q)) > 0
            or exists (select 1 from public.media_tags t join public.tags g on g.id = t.tag_id where t.media_id = m.id and strpos(lower(g.name), lower(p_q)) > 0))
  ),
  r as (
    select f.*,
           row_number() over (order by
             case when p_sort = 'reach' and p_asc is not true then f.reach end desc nulls last,
             case when p_sort = 'reach' and p_asc then f.reach end asc nulls last,
             case when p_sort = 'views' and p_asc is not true then f.views end desc nulls last,
             case when p_sort = 'views' and p_asc then f.views end asc nulls last,
             case when p_sort = 'engagement' and p_asc is not true then f.er end desc nulls last,
             case when p_sort = 'engagement' and p_asc then f.er end asc nulls last,
             case when p_sort = 'date' and p_asc then f.posted_at end asc,
             case when p_sort = 'date' and p_asc then f.id end asc,
             f.posted_at desc, f.id desc) as n,
           count(*) over () as total
      from f
  )
  select r.id, r.media_type, r.posted_at, r.permalink, r.caption, r.cover_status, r.children_count,
         r.reach, r.views, r.likes, r.comments, r.saves, r.shares,
         array(select t.tag_id from public.media_tags t where t.media_id = r.id order by t.tag_id),
         r.n, r.total
    from r
   where r.n > p_offset and r.n <= p_offset + p_limit
   order by r.n
$$;

-- 2. Stories of one account posted in [p_from, p_to) with their FINAL numbers: the newest snapshot taken before the
-- Story expired (expires_at, else posted_at + 1 day), else the newest one (= buildStories in lib/dashboard/content.ts);
-- "measured" = it has a snapshot (Instagram shares no numbers under 5 viewers). p_measured null = all.
-- p_sort 'newest' pages by owner-timezone DAYS (p_tz): the page is the days ranked (p_offset, p_offset + p_limit],
-- newest day first, with every Story of those days, so a day is never split. 'views' (final views) and 'exit' (final
-- exits / final views, null without views) page by Story; nulls last, ties newest first.
-- The snapshot count and the views series (oldest first) are read for the returned page only.
create or replace function public.story_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_measured boolean, p_sort text, p_offset int, p_limit int)
returns table (id text, posted_at timestamptz, expires_at timestamptz, permalink text, cover_status text, captured_at timestamptz, reach int, views int, replies int, shares int, total_interactions int, taps_forward int, taps_back int, exits int, snapshots int, progression int[], n bigint, items bigint, days bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select m.id, m.posted_at, m.expires_at, m.permalink, m.cover_status,
           (m.posted_at at time zone p_tz)::date as day,
           s.captured_at, s.reach, s.views, s.replies, s.shares, s.total_interactions, s.taps_forward, s.taps_back, s.exits,
           case when s.exits is not null and s.views > 0 then s.exits::numeric / s.views end as exit_rate
      from public.media m
      left join lateral (
        select u.captured_at, u.reach, u.views, u.replies, u.shares, u.total_interactions, u.taps_forward, u.taps_back, u.exits
          from ((select 1 as k, x.captured_at, x.reach, x.views, x.replies, x.shares, x.total_interactions, x.taps_forward, x.taps_back, x.exits
                   from public.media_metrics x
                  where x.media_id = m.id and x.captured_at <= coalesce(m.expires_at, m.posted_at + interval '1 day')
                  order by x.captured_at desc
                  limit 1)
                union all
                (select 2, x.captured_at, x.reach, x.views, x.replies, x.shares, x.total_interactions, x.taps_forward, x.taps_back, x.exits
                   from public.media_metrics x
                  where x.media_id = m.id
                  order by x.captured_at desc
                  limit 1)) u
         order by u.k
         limit 1
      ) s on true
     where m.account_id = p_account
       and m.media_type = 'STORY'
       and m.posted_at >= p_from and m.posted_at < p_to
       and (p_measured is null or (s.captured_at is not null) = p_measured)
  ),
  r as (
    select f.*,
           dense_rank() over (order by f.day desc) as day_n,
           row_number() over (order by
             case when p_sort = 'views' then f.views end desc nulls last,
             case when p_sort = 'exit' then f.exit_rate end desc nulls last,
             f.posted_at desc, f.id desc) as n,
           count(*) over () as items
      from f
  ),
  p as (
    select r.*, (select coalesce(max(r2.day_n), 0) from r r2) as days
      from r
     where case when p_sort = 'newest' then r.day_n > p_offset and r.day_n <= p_offset + p_limit
                else r.n > p_offset and r.n <= p_offset + p_limit end
  )
  select p.id, p.posted_at, p.expires_at, p.permalink, p.cover_status, p.captured_at, p.reach, p.views, p.replies,
         p.shares, p.total_interactions, p.taps_forward, p.taps_back, p.exits,
         coalesce(c.snapshots, 0), coalesce(c.progression, '{}'), p.n, p.items, p.days
    from p
    left join lateral (
      select count(*)::int as snapshots, array_agg(x.views order by x.captured_at) as progression
        from public.media_metrics x
       where x.media_id = p.id
    ) c on true
   order by p.n
$$;

revoke execute on function public.post_list(uuid, timestamptz, timestamptz, text, text, uuid, boolean, text, boolean, int, int) from public, anon;
revoke execute on function public.story_list(uuid, timestamptz, timestamptz, text, boolean, text, int, int) from public, anon;
grant execute on function public.post_list(uuid, timestamptz, timestamptz, text, text, uuid, boolean, text, boolean, int, int) to authenticated;
grant execute on function public.story_list(uuid, timestamptz, timestamptz, text, boolean, text, int, int) to authenticated;
