# Runbook — Explorer, rollups and drill-down (Plan 12b)

Live checks for the owner (with the assistant). Nothing here has been verified on the live project yet: the SQL was
verified on a local PostgreSQL 16 with the repo's real migrations, a stand-in for Supabase's `auth` schema and
2 years × 10 accounts of synthetic data (see the plan's "Dry-run result"); the UI only in jsdom tests.

## 0. Apply the migration BEFORE deploying the code

The new code calls four SQL functions and a table that exist only after `supabase/migrations/20261024000001_explorer.sql`.
Deploying first breaks `/explorer` (the page shows the error screen) — nothing else depends on them.

```bash
# with .env.local loaded into the shell environment (never print the values; see docs/HANDOVER.md §4)
npx supabase db push --yes --password "$SUPABASE_DB_PASSWORD"
```

Then in the Supabase SQL editor:

```sql
select proname, prosecdef from pg_proc where proname like 'explorer_%' order by 1;
-- 4 rows (explorer_daily, explorer_followers, explorer_media, explorer_posts), prosecdef = false (security invoker)
select count(*) from public.explorer_views;               -- 0
select polname, pg_get_expr(polqual, polrelid) from pg_policy where polname in ('media_metrics_owner_select', 'account_daily_owner_select');
-- the expression reads ( SELECT is_owner() AS is_owner ): the owner check runs once per query
```

Run the database advisors (Supabase dashboard → Advisors → Security and Performance): no new warnings for the
`explorer_*` functions (each pins `search_path`) or for `explorer_views` (RLS on, one owner policy).

## 1. Layout: 360 / 768 / 1280 × themes

Open `/explorer` in each width (DevTools device toolbar) and in each theme (Ink, Sunset, Forest, Mono) in light and dark:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| No horizontal page scroll; the table becomes cards on phones | | | |
| Settings stack above the results (360/768); a sticky left column (1280) that scrolls on its own | | | |
| The phone tab bar shows 6 items, labels readable (en and zh-CN) | | — | — |
| Chart colours and the muted comparison series are visible in every theme, light and dark | | | |
| Breadcrumb wraps instead of overflowing with a 40-character group name and a long @username | | | |

## 2. Explore and compare

1. Overview → click the **Reach** tile → `/explorer?m=reach&by=group…` (or `by=account` without groups).
2. Pick metrics (max 4; account totals are disabled when you break down by format/tag/weekday/hour or filter content),
   **Break down by** each option, **Apply**. Numbers must match the Overview KPI for the same range (Reach, Engagement).
3. Time Scope: 1y + "same period last year" → each row shows a change; "Over time" draws two lines (the second dashed).

## 3. Drill-down round trip keeps the scope

Set the scope to **90d, same period last year**, then: Explorer by group → click a group row → its accounts → click an
account → its formats → click **Reels** → single posts → click a post → the item level (followers around the post,
followers/non-followers that day). At every step the URL keeps `from=90d&cmp=yoy`, the breadcrumb grows, and each
breadcrumb link goes back up with the scope. Browser **Back** walks the same path backwards.
Also from the account page: Format comparison row → single posts; Best time → "Your post performance" cell → the posts
of that weekday/hour (all history); Posts tab → a post title → its item level. Over time → click a month bar → that
month by weeks → a week → its days → a day → its posts.

## 4. One year performance (Server-Timing)

1. Explorer, **1y**, break down by **Account** with 4 metrics, then by **Format** and **Over time**.
2. DevTools → Network: the document/RSC request's "Waiting for server response" should stay ≤ 1.2 s (the budget in
   `docs/RUNBOOK_PERF.md`).
3. Click **Export view**: the `/api/export/explorer` response has `Server-Timing: explorer;dur=…` = the same loader as
   the page. Note the value here: ______ ms (1y by account) / ______ ms (1y by format) / ______ ms (all, by month).
4. If anything is over ~1 s: in the SQL editor run `explain analyze` on the slow call (e.g. `select * from
   public.explorer_posts(array['<account uuid>']::uuid[], now() - interval '1 year', now(), 'Asia/Kuala_Lumpur', null,
   true, null, false, null, null, 'format', 'day', 'mon');`) and send the plan to the assistant. The upgrade path is a
   `media_latest` table maintained by the sync (plan Decisions).

## 5. Security: nobody but the owner gets rows

SQL editor (it runs as `postgres`). First copy one account id: `select id from public.accounts limit 1;`

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","aal":"aal1"}', true);
select count(*) from public.explorer_daily(array['<account uuid>']::uuid[], current_date - 365, current_date, 'account', 'day', 'mon'); -- 0
select count(*) from public.explorer_media(array['<account uuid>']::uuid[], now() - interval '1 year', now(), 'UTC', null, true, null, false, null, null); -- 0
select count(*) from public.explorer_views; -- 0
rollback;

begin;
set local role anon;
select public.explorer_daily(array['<account uuid>']::uuid[], current_date - 30, current_date, 'account', 'day', 'mon'); -- ERROR: permission denied for function explorer_daily
rollback;
```

In the browser while signed out: `/explorer` redirects to `/login`; `/api/export/explorer?m=reach&by=account` answers
401 (never data). Hand-edited URLs (`?by=drop`, `?m=__proto__`, `?acc=' or 1=1`) show the default view, never an error
page with database text; the export answers `400 bad_params`.

## 6. Saved views

Save the current view ("Reels by hour"), reload, open it from the list → the same URL. Rename it (same name in another
case is fine; another view's name says "already exists"), delete it (confirmation first). A view saved with **30d**
still means "the last 30 days" next week; a view saved with fixed dates keeps them.

## 7. Known limits (by design)

- Instagram has **no hourly reach or views**: account insights are daily totals. The only intraday series is the follower
  count from every sync (`follower_snapshots`, since Plan 11). Hour/weekday in the Explorer = when a post was published.
- Account totals (followers, reach, views, interactions, net follows, engagement) can't be split by format, tag,
  weekday or hour; post metrics can. The audience slice of a post is the account's reach of that format on that day
  (`account_daily_breakdown`: a 90-day backfill on 16 Oct 2026, daily since), not the single post's.
- Stories count in post metrics only when you choose the Stories format or break down by format.
- Single posts: the newest 500 in the range (the page says when the list is cut). Under the preset **All**, and in the
  best-time heatmap drill-down ("Your post performance" cell), the list covers all stored posts (up to 5 years), still the
  newest 500.
- A timezone that the browser knows but Postgres does not (very rare, deprecated names) makes the Explorer show the
  error screen: pick a zone from the Settings list.
- Days follow the KPI cards: a rolling range ends on the OLDEST settled insight day among the accounts in scope whose
  sync is within the 3-day lag window (Instagram lags up to 48 h), so one lagging account never shows as a dip at the end
  of the chart. An account whose sync is older than that window, or that never synced, is ignored for this, so it cannot
  pull every window back.
- Daily grouping over a range longer than 900 days is shown weekly (PostgREST returns at most 1,000 rows per call).
- The comparison "over time" is drawn only for buckets that are complete in both periods: a partial first or last week
  or month shows no change.

## 8. Rollback

**Order: deploy the previous code FIRST, then run the SQL.** The `/explorer` page and its export call the four functions
and the table; if they vanish while the new code is still live, `/explorer` shows the error screen. Overview and the
account pages do not call them, so they keep working either way.

```sql
begin;

-- (a) give the five policies their original predicate back (same result, only the per-row evaluation returns)
alter policy account_daily_owner_select on public.account_daily using (public.is_owner());
alter policy media_owner_select on public.media using (public.is_owner());
alter policy media_metrics_owner_select on public.media_metrics using (public.is_owner());
alter policy media_tags_owner_all on public.media_tags using (public.is_owner()) with check (public.is_owner());
alter policy follower_snapshots_owner_select on public.follower_snapshots using (public.is_owner());

-- (b) the four rollup functions (exact argument types)
drop function public.explorer_daily(uuid[], date, date, text, text, text);
drop function public.explorer_media(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int);
drop function public.explorer_posts(uuid[], timestamptz, timestamptz, text, text, boolean, uuid, boolean, int, int, text, text, text);
drop function public.explorer_followers(uuid, timestamptz, timestamptz, text, boolean);

-- (c) the saved views table: THIS DELETES THE OWNER'S SAVED VIEWS (nothing else reads them)
drop table public.explorer_views;

commit;
```

Dropping `explorer_views` deletes every saved Explorer view for good. Leave step (c) out if you want to keep them; the
table is harmless on its own.

## What to send if it fails

The URL (it holds the whole view), the width/theme, a screenshot, the `Server-Timing` value, and for SQL problems the
error code (never paste tokens or the service key).
