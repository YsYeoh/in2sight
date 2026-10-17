-- Plan 12b: Explorer rollups + saved views. All additive. Apply BEFORE deploying the code that calls these functions.
--
-- Every function is `security invoker`: it runs with the caller's rights, so the owner-only RLS policies of the tables it
-- reads still apply (any other session gets empty results). Execute is revoked from public/anon and granted to
-- `authenticated` only. Inputs are typed (uuid[], date, timestamptz, int, boolean); the few text inputs are only compared
-- inside CASE expressions or passed to `at time zone`, never concatenated into SQL. Results are one row per bucket or
-- group (well under PostgREST's 1000-row cap); metric values are computed from these additive parts in lib/metrics.ts.
-- Time buckets: 'day' | 'week' (first day = p_week_start 'mon' | 'sun') | 'month'. The bucket CASE is written inline in
-- explorer_daily and explorer_posts on purpose: a helper function with `set search_path` cannot be inlined and made the
-- 2-year rollups ~3x slower (measured in the plan's dry run).

-- 1. RLS cost: the owner check becomes an InitPlan evaluated once per statement instead of once per row. Same predicate,
-- same result; on 10 accounts x 2 years it took the slowest rollup from ~5 s to ~0.1 s (dry run).
alter policy account_daily_owner_select on public.account_daily using ((select public.is_owner()));
alter policy media_owner_select on public.media using ((select public.is_owner()));
alter policy media_metrics_owner_select on public.media_metrics using ((select public.is_owner()));
alter policy media_tags_owner_all on public.media_tags using ((select public.is_owner())) with check ((select public.is_owner()));
alter policy follower_snapshots_owner_select on public.follower_snapshots using ((select public.is_owner()));

-- 2. Account days (owner-timezone days, as the sync writes them) summed per account (p_by = 'account') or per time
-- bucket over all given accounts (any other p_by). followers is a level, not a flow: the last value of each account in
-- the bucket, summed over the accounts. Engagement-rate parts only count days that have both reach and interactions.
create or replace function public.explorer_daily(p_accounts uuid[], p_from date, p_to date, p_by text, p_grain text, p_week_start text)
returns table (key text, reach bigint, views bigint, interactions bigint, er_interactions bigint, er_reach bigint, net_follows bigint, followers bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with d as (
    select a.account_id, a.day, a.reach, a.views, a.total_interactions, a.followers, a.follows - a.unfollows as net,
           case when p_by = 'account' then a.account_id::text
                else to_char(case p_grain
                       when 'month' then date_trunc('month', a.day::timestamp)::date
                       when 'week' then a.day - ((extract(dow from a.day)::int - case when p_week_start = 'sun' then 0 else 1 end + 7) % 7)
                       else a.day
                     end, 'YYYY-MM-DD') end as key
      from public.account_daily a
     where a.account_id = any (p_accounts) and a.day between p_from and p_to
  ),
  f as (
    select distinct on (d.key, d.account_id) d.key, d.followers
      from d
     where d.followers is not null
     order by d.key, d.account_id, d.day desc
  )
  select d.key,
         sum(d.reach)::bigint,
         sum(d.views)::bigint,
         sum(d.total_interactions)::bigint,
         (sum(d.total_interactions) filter (where d.reach is not null and d.total_interactions is not null))::bigint,
         (sum(d.reach) filter (where d.reach is not null and d.total_interactions is not null))::bigint,
         sum(d.net)::bigint,
         (select sum(f.followers) from f where f.key = d.key)::bigint
    from d
   group by d.key
   order by d.key
$$;

-- 3. Media published in [p_from, p_to) with their LATEST metrics snapshot (lifetime values) and the owner-timezone day,
-- weekday (0 = Sunday) and hour they were published. Stories only when p_stories. Filters: format, tag or untagged,
-- weekday, hour (null / false = no filter; a NULL boolean is treated as false, so it can never change the meaning).
-- Captions are cut to 200 characters (the table shows a snippet).
create or replace function public.explorer_media(p_accounts uuid[], p_from timestamptz, p_to timestamptz, p_tz text, p_format text, p_stories boolean, p_tag uuid, p_untagged boolean, p_weekday int, p_hour int)
returns table (id text, account_id uuid, media_type text, posted_at timestamptz, permalink text, caption text, local_day date, weekday int, hour int, reach int, views int, likes int, comments int, saves int, shares int)
language sql
stable
security invoker
set search_path = ''
as $$
  select m.id, m.account_id, m.media_type, m.posted_at, m.permalink, left(m.caption, 200),
         l.at::date, extract(dow from l.at)::int, extract(hour from l.at)::int,
         s.reach, s.views, s.likes, s.comments, s.saves, s.shares
    from public.media m
   cross join lateral (select m.posted_at at time zone p_tz as at) l
    left join lateral (
      select x.reach, x.views, x.likes, x.comments, x.saves, x.shares
        from public.media_metrics x
       where x.media_id = m.id
       order by x.captured_at desc
       limit 1
    ) s on true
   where m.account_id = any (p_accounts)
     and m.posted_at >= p_from and m.posted_at < p_to
     and (p_format is null or m.media_type = p_format)
     and (coalesce(p_stories, false) or m.media_type <> 'STORY')
     and (p_weekday is null or extract(dow from l.at)::int = p_weekday)
     and (p_hour is null or extract(hour from l.at)::int = p_hour)
     and (p_tag is null or exists (select 1 from public.media_tags t where t.media_id = m.id and t.tag_id = p_tag))
     and (not coalesce(p_untagged, false) or not exists (select 1 from public.media_tags t where t.media_id = m.id))
$$;

-- 4. The media of explorer_media() summed per account, format, tag ('untagged' for none; a post with several tags counts
-- for each), weekday, hour, or time bucket of the publishing day. "measured" = items with reach > 0 (the base of averages,
-- like lib/analysis/posts.ts groupStats); engagement-rate parts never include Stories.
create or replace function public.explorer_posts(p_accounts uuid[], p_from timestamptz, p_to timestamptz, p_tz text, p_format text, p_stories boolean, p_tag uuid, p_untagged boolean, p_weekday int, p_hour int, p_by text, p_grain text, p_week_start text)
returns table (key text, posts bigint, measured bigint, reach_sum bigint, views_sum bigint, views_n bigint, likes bigint, comments bigint, saves bigint, shares bigint, er_interactions bigint, er_reach bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select * from public.explorer_media(p_accounts, p_from, p_to, p_tz, p_format, p_stories, p_tag, p_untagged, p_weekday, p_hour)
  ),
  k as (
    select b.media_type, b.reach, b.views, b.likes, b.comments, b.saves, b.shares,
           case p_by
             when 'account' then b.account_id::text
             when 'format' then b.media_type
             when 'weekday' then b.weekday::text
             when 'hour' then b.hour::text
             else to_char(case p_grain
                    when 'month' then date_trunc('month', b.local_day::timestamp)::date
                    when 'week' then b.local_day - ((extract(dow from b.local_day)::int - case when p_week_start = 'sun' then 0 else 1 end + 7) % 7)
                    else b.local_day
                  end, 'YYYY-MM-DD')
           end as key
      from b
     where p_by <> 'tag'
    union all
    select b.media_type, b.reach, b.views, b.likes, b.comments, b.saves, b.shares, coalesce(t.tag_id::text, 'untagged')
      from b
      left join public.media_tags t on t.media_id = b.id
     where p_by = 'tag'
  )
  select k.key,
         count(*),
         count(*) filter (where k.reach > 0),
         (sum(k.reach) filter (where k.reach > 0))::bigint,
         sum(k.views)::bigint,
         count(k.views),
         sum(k.likes)::bigint,
         sum(k.comments)::bigint,
         sum(k.saves)::bigint,
         sum(k.shares)::bigint,
         (sum(coalesce(k.likes, 0) + coalesce(k.comments, 0) + coalesce(k.saves, 0) + coalesce(k.shares, 0)) filter (where k.reach > 0 and k.media_type <> 'STORY'))::bigint,
         (sum(k.reach) filter (where k.reach > 0 and k.media_type <> 'STORY'))::bigint
    from k
   group by k.key
   order by k.key
$$;

-- 5. Follower curve of one account from follower_snapshots (every sync tick, ~30 min): the last value per owner-timezone
-- hour (p_hourly) or day. Instagram's account insights are daily only: this is the ONLY intraday series we have.
create or replace function public.explorer_followers(p_account uuid, p_from timestamptz, p_to timestamptz, p_tz text, p_hourly boolean)
returns table (at text, followers int)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (b.at) to_char(b.at, case when p_hourly then 'YYYY-MM-DD"T"HH24:00' else 'YYYY-MM-DD' end), f.followers
    from public.follower_snapshots f
   cross join lateral (select date_trunc(case when p_hourly then 'hour' else 'day' end, f.captured_at at time zone p_tz) as at) b
   where f.account_id = p_account and f.captured_at >= p_from and f.captured_at < p_to and f.followers is not null
   order by b.at, f.captured_at desc
$$;

revoke execute on function public.explorer_daily(uuid[], date, date, text, text, text) from public, anon;
revoke execute on function public.explorer_media(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int) from public, anon;
revoke execute on function public.explorer_posts(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text) from public, anon;
revoke execute on function public.explorer_followers(uuid, timestamptz, timestamptz, text, boolean) from public, anon;
grant execute on function public.explorer_daily(uuid[], date, date, text, text, text) to authenticated;
grant execute on function public.explorer_media(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int) to authenticated;
grant execute on function public.explorer_posts(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text) to authenticated;
grant execute on function public.explorer_followers(uuid, timestamptz, timestamptz, text, boolean) to authenticated;

-- 6. Saved Explorer views: owner-authored data (like tags), so the owner session may select/insert/update/delete under
-- RLS. state = the canonical, allow-listed query parameters of the view (re-validated by the app on every read).
create table public.explorer_views (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60 and name = btrim(name)),
  state      jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index explorer_views_name_lower_key on public.explorer_views (lower(name));
alter table public.explorer_views enable row level security;
create policy explorer_views_owner_all on public.explorer_views
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
revoke all on public.explorer_views from anon;
