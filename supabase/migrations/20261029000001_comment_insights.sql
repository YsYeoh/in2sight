-- Plan 15c: comment insights (READ-ONLY): one page of comments, fans, commenters who don't follow you. Additive: one
-- policy rewrite and three functions, nothing else. Apply BEFORE deploying the code that calls them; until then the
-- Comments tab says "needs a database update" (docs/RUNBOOK_COMMENTS.md §0) and only Topics works, so the order is
-- safe either way. Needs public.follower_exports (Plan 15b, 20261028000002) to exist: SQL function bodies are checked
-- at creation.
--
-- Third-party personal data (commenter usernames and texts): the functions are `security invoker`, so the owner-only
-- RLS of comments, media and follower_exports applies inside them (any other session gets no rows). Execute is revoked
-- from public/anon and granted to `authenticated` only. Inputs are typed; text inputs are only compared or searched
-- with strpos (p_q: no pattern, so % and _ are plain characters); p_question_re is the app's own constant
-- (lib/comments/question.ts QUESTION_PATTERN) used with ~*, never concatenated into SQL. Rows are numbered 1..total in
-- the order shown (n); the page is n in (p_offset, p_offset + p_limit], at most 200; every row carries the total.

-- 1. The comments policy in InitPlan form (is_owner() once per query, not once per row; 20261024000001 did the same
-- for five other tables). Same meaning: select for the owner only.
alter policy comments_owner_select on public.comments using ((select public.is_owner()));

-- 2. One page of an account's comments in [p_from, p_to), newest first. Filters (null / not true = none): p_media one
-- post; p_q in the text or the username (case-insensitive); p_question_re the question rule; p_fan_min only authors
-- with at least that many comments ever (the owner left out); p_unanswered only comments with no reply seen, not the
-- owner's own. "replied" is DERIVED (thread replies are not stored): a LATER top-level comment on the same post by the
-- account's username (p_owner) that @mentions the author. ponytail: @amy also matches @amy2; good enough for a hint.
create or replace function public.comment_list(p_account uuid, p_from timestamptz, p_to timestamptz, p_q text, p_media text, p_question_re text, p_unanswered boolean, p_fan_min int, p_owner text, p_offset int, p_limit int)
returns table (id text, media_id text, author_username text, body text, like_count int, commented_at timestamptz, hidden boolean, replied boolean, media_type text, posted_at timestamptz, caption text, n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with f as (
    select c.id, c.media_id, c.author_username, c.text, c.like_count, c.commented_at, c.hidden,
           exists (
             select 1 from public.comments o
              where o.media_id = c.media_id
                and lower(o.author_username) = lower(p_owner)
                and o.commented_at > c.commented_at
                and strpos(lower(coalesce(o.text, '')), '@' || lower(c.author_username)) > 0
           ) as replied
      from public.comments c
     where c.account_id = p_account
       and c.commented_at >= p_from and c.commented_at < p_to
       and (p_media is null or c.media_id = p_media)
       and (p_q is null or strpos(lower(coalesce(c.text, '')), lower(p_q)) > 0 or strpos(lower(coalesce(c.author_username, '')), lower(p_q)) > 0)
       and (p_question_re is null or coalesce(c.text, '') ~* p_question_re)
       and (p_fan_min is null or lower(c.author_username) in (
             select lower(x.author_username) from public.comments x
              where x.account_id = p_account and x.author_username is not null and lower(x.author_username) <> lower(p_owner)
              group by 1 having count(*) >= p_fan_min))
  ),
  r as (
    select f.*,
           row_number() over (order by f.commented_at desc, f.id desc) as n,
           count(*) over () as total
      from f
     where p_unanswered is not true or (not f.replied and f.author_username is not null and lower(f.author_username) <> lower(p_owner))
  )
  select r.id, r.media_id, r.author_username, r.text, r.like_count, r.commented_at, r.hidden, r.replied,
         m.media_type, m.posted_at, left(m.caption, 100), r.n, r.total
    from r
    left join public.media m on m.id = r.media_id
   where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)
   order by r.n
$$;

-- 3. Commenters of one account over every stored comment, by lower-cased username (author_id is not stored), the
-- owner (p_owner) left out: comments, likes on their comments (missing as 0), first and latest comment. p_mode:
-- 'top' everyone, by comments, likes, latest, name; 'new' first comment within p_days of p_now and at least p_new_min
-- comments, newest first comment first; 'quiet' at least p_fan_min comments, none within p_days, and at least
-- p_quiet_posts feed posts/Reels published after their latest comment (posts_since; only computed for 'quiet').
-- The rule values come from lib/comments/view.ts FAN_RULES (one source).
create or replace function public.comment_fans(p_account uuid, p_owner text, p_mode text, p_now timestamptz, p_fan_min int, p_new_min int, p_days int, p_quiet_posts int, p_offset int, p_limit int)
returns table (username text, comments bigint, likes bigint, first_at timestamptz, last_at timestamptz, posts_since bigint, n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with a as (
    select lower(c.author_username) as username, count(*) as comments, coalesce(sum(c.like_count), 0)::bigint as likes,
           min(c.commented_at) as first_at, max(c.commented_at) as last_at
      from public.comments c
     where c.account_id = p_account
       and c.author_username is not null and lower(c.author_username) <> lower(p_owner)
     group by 1
  ),
  b as (
    select a.*,
           case when p_mode = 'quiet' then (
             select count(*) from public.media m
              where m.account_id = p_account and m.media_type <> 'STORY' and m.posted_at > a.last_at and m.posted_at <= p_now
           ) end as posts_since
      from a
  ),
  f as (
    select b.* from b
     where (p_mode = 'top')
        or (p_mode = 'new' and b.first_at >= p_now - p_days * interval '1 day' and b.comments >= p_new_min)
        or (p_mode = 'quiet' and b.comments >= p_fan_min and b.last_at < p_now - p_days * interval '1 day' and b.posts_since >= p_quiet_posts)
  ),
  r as (
    select f.*,
           row_number() over (order by case when p_mode = 'new' then f.first_at end desc, f.comments desc, f.likes desc, f.last_at desc, f.username) as n,
           count(*) over () as total
      from f
  )
  select r.username, r.comments, r.likes, r.first_at, r.last_at, r.posts_since, r.n, r.total
    from r
   where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)
   order by r.n
$$;

-- 4. Commenters (every stored comment, lower-cased, the owner left out) whose username is NOT in the followers of the
-- account's NEWEST follower export (Plan 15b; names there are lower-cased by lib/followers/parse.ts). Snapshot-based.
-- The anti-join runs on the unnested array (a hash join over up to 50,000 names), never `= any(array)` per commenter.
-- No export = no rows (the app checks listFollowerSnapshots first and says "upload an export").
create or replace function public.comment_outsiders(p_account uuid, p_owner text, p_offset int, p_limit int)
returns table (username text, comments bigint, last_at timestamptz, n bigint, total bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select e.followers
      from public.follower_exports e
     where e.account_id = p_account
     order by e.taken_on desc, e.created_at desc
     limit 1
  ),
  f as (
    select unnest(s.followers) as u from s
  ),
  a as (
    select lower(c.author_username) as username, count(*) as comments, max(c.commented_at) as last_at
      from public.comments c
     where c.account_id = p_account
       and c.author_username is not null and lower(c.author_username) <> lower(p_owner)
     group by 1
  ),
  o as (
    select a.* from a
     where exists (select 1 from s) and not exists (select 1 from f where f.u = a.username)
  ),
  r as (
    select o.*,
           row_number() over (order by o.comments desc, o.last_at desc, o.username) as n,
           count(*) over () as total
      from o
  )
  select r.username, r.comments, r.last_at, r.n, r.total
    from r
   where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)
   order by r.n
$$;

revoke execute on function public.comment_list(uuid, timestamptz, timestamptz, text, text, text, boolean, int, text, int, int) from public, anon;
revoke execute on function public.comment_fans(uuid, text, text, timestamptz, int, int, int, int, int, int) from public, anon;
revoke execute on function public.comment_outsiders(uuid, text, int, int) from public, anon;
grant execute on function public.comment_list(uuid, timestamptz, timestamptz, text, text, text, boolean, int, text, int, int) to authenticated;
grant execute on function public.comment_fans(uuid, text, text, timestamptz, int, int, int, int, int, int) to authenticated;
grant execute on function public.comment_outsiders(uuid, text, int, int) to authenticated;
