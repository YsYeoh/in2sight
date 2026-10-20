# Runbook — Posts and Stories lists (Plan 14b)

Live checks for the owner (with the assistant). The SQL was verified on a throwaway PostgreSQL (PGlite = PostgreSQL 18 in
WASM; see the plan's "Dry-run result"); the UI only in jsdom tests. Never paste tokens, CDN URLs or captions of other
people into chats or issues.

## 0. The migration (apply BEFORE or right after deploying; the owner says go)

**Status: written and tested, NOT applied to the live database.** Apply it only on the owner's go-ahead, before deploying
code that needs it; until then the tabs fall back to the old capped reads (see below).

`supabase/migrations/20261027000001_post_story_lists.sql` adds two `security invoker` functions, `post_list` and
`story_list`. Until it is applied, the Posts and Stories tabs fall back to the old capped reads (Posts: every post of
the chosen dates; Stories: the newest 200 of the chosen dates, with "Showing the newest 200 Stories.") and apply the
same filters, sort and pages in TypeScript, so the order of deploy and migration does not break anything. Apply:

```bash
# with .env.local loaded into the shell environment (never print the values; see docs/HANDOVER.md §0 "How it was applied")
npx supabase migration list            # expect only 20261027000001 pending, nothing remote-only
npx supabase db push --dry-run --password "$SUPABASE_DB_PASSWORD"   # expect exactly that file
npx supabase db push --yes --password "$SUPABASE_DB_PASSWORD"
```

Confirm in the Supabase SQL editor:

```sql
select proname, prosecdef from pg_proc where proname in ('post_list', 'story_list') order by 1;
-- 2 rows, prosecdef = false (security invoker)
```

Then Supabase dashboard → Advisors → Security and Performance: no new warning for the two functions (both pin `search_path`).
After the push, the Stories tab no longer says "Showing the newest 200 Stories." for an account with more.

## 1. Layout: 360 / 768 / 1280 × themes, keyboard

Account page → Posts, then Stories, in each width (DevTools device toolbar) and each theme in light and dark:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| The toolbar wraps, every control the same height, no sideways page scroll | | | |
| "Posted" opens as a bottom sheet (phone) / a centred dialog (wider), Esc and Done close it, focus returns | | | |
| Chips and Clear all wrap under the toolbar; the page navigation wraps and stays centred | | | |
| No range bar (Last 7 / 14 / 30 Days) on Posts or Stories | | | |

Keyboard only: Tab through search → Posted → Format → Tag → Sort → Grid | Table → the table headers → the page buttons;
arrow keys change a select and the list follows at once; the search box keeps focus while you type (the list updates
after a short pause, the top bar runs, the box is never reset).

## 2. Posts

1. Opens on All time, newest first, page 1: "1–50 of N posts" (table) and "Page 1 of …" when there are more than 50.
2. Type part of a caption, then part of a tag name: both find posts (upper/lower case does not matter); `50%` or `_` find
   only posts that really contain them.
3. Posted: Last 7 days / Last 30 days / Last 90 days / This year / All time, and custom dates (from–to): the button names
   the window; a chip appears; the posts outside the window disappear. An old link with `?from=2026-09-01&to=2026-09-30`
   is ignored here (the list stays All time) but going back to Overview keeps that range.
4. Format and Tag (incl. Untagged) combine with the search and the dates; each change goes back to page 1; each chip
   removes only its own filter; Clear all keeps Sort, Grid/Table and the Overview range.
5. Sort: all eight orders; in the table, click Reach, Views, Engagement rate, Post: first click = most / newest, second
   click = the other way; the arrow and the Sort select agree. Posts without numbers are always at the end.
6. Pages: Next / Previous / First / Last keep every filter; Grid shows 24 per page, Table 50; switching Grid ↔ Table
   keeps roughly the same posts on screen. Change the URL to `page=999` → page 1 is shown.
7. A post's title / date still opens the Explorer item level and its flask the Post Lab — both without `from=` in the URL.

## 3. Stories

1. Opens on All time, newest first: day strips, 7 days per page; a day is never split between pages.
2. Sort "Most views" / "Highest exit rate": one flat list, 48 per page, each frame with its date and time; Stories
   without numbers at the end.
3. Numbers: Measured / Not measured (under 5 viewers) — the not-measured ones say so in their frame.
4. An account with more than 200 Stories: every page is reachable (the 200 cap is gone once the migration is applied).
5. Spot-check one Story: its views and exit rate in the frame equal the drawer and the Post Lab.

## 4. The SQL order equals the screen's numbers

On Posts sorted by Best engagement, the Engagement rate column must never go up while you scroll down (page 1 → 2 → …);
the same for Reach and Views, and for Stories' exit rate. A post whose rate is "—" sits after every post with a number.

## 5. Speed (big accounts)

The dry run measured, on 5,000 posts × 20 snapshots and 3,000 Stories × 48 snapshots for one account (PGlite, slower than
Supabase): a Posts page 130–160 ms whatever the sort, a search 40 ms, a Stories page 150–250 ms. Live:

- DevTools → Network on a Posts and a Stories page change: "Waiting for server response" within the 1.2 s budget of
  docs/RUNBOOK_PERF.md. Note here: Posts ____ ms, Stories ____ ms.
- SQL editor, with the account that has the most posts (`select account_id, count(*) from public.media group by 1 order by 2 desc limit 1;`):

```sql
explain (analyze, buffers) select * from public.post_list('<account id>', now() - interval '5 years', now() + interval '1 day', null, null, null, false, 'engagement', false, 0, 50);
explain (analyze, buffers) select * from public.story_list('<account id>', now() - interval '5 years', now() + interval '1 day', 'Asia/Kuala_Lumpur', null, 'newest', 0, 7);
```

  Both should finish in well under 500 ms. If `post_list` grows past that on a very big account (tens of thousands of
  posts), the upgrade is a newest-first shortcut (no window count for the default sort) or a materialised latest-snapshot
  column; note the numbers and tell the assistant.

## 6. Security: nobody but the owner gets rows

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","aal":"aal1"}', true);
select count(*) from public.post_list('<account id>', now() - interval '5 years', now(), null, null, null, false, 'date', false, 0, 50);   -- 0
select count(*) from public.story_list('<account id>', now() - interval '5 years', now(), 'UTC', null, 'newest', 0, 7);                   -- 0
rollback;

begin;
set local role anon;
select * from public.post_list('<account id>', now(), now(), null, null, null, false, 'date', false, 0, 1); -- ERROR: permission denied for function post_list
rollback;
```

Changing the account id in the URL to an archived or unknown account → 404 (unchanged).

## 7. Known limits (by design)

- Search is a plain substring (no accent folding: "cafe" does not find "café"); at most 100 characters.
- "All time" reaches back 5 years (the app-wide floor, `MAX_DAYS`).
- The exports still read the newest 200 Stories per account per range (`STORY_LIMIT`); `story_list` is their upgrade path.

## What to send if it fails

The URL (without tokens), the width and theme, the numbers you expected and saw, and for SQL checks the full output.
