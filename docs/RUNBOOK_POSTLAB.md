# Runbook — Post Lab (Plan 13b)

Live checks for the owner (with the assistant). The migration is applied to the live project, but nothing else here has been
verified live: the SQL was verified on a local PostgreSQL 16 with the repo's real migrations and a stand-in for
Supabase's `auth` schema (see the plan's "Dry-run result"); the UI only in jsdom tests. Never paste tokens, CDN URLs or captions of other people into
chats or issues.

## 0. The migration (already applied to the live project, 2026-10-19)

The Post Lab calls two SQL functions that exist only after `supabase/migrations/20261026000001_post_lab.sql`. Without
them `/accounts/<id>/media/<mediaId>` shows "The Post Lab needs a database update" (no crash); no other page calls them.
This migration, and Plan 12b's `20261024000001_explorer.sql` before it, are ALREADY APPLIED to the live project, so
there is nothing to push; only confirm the functions exist (the owner-path checks are still unrun). For a fresh
environment, `db push` applies every pending migration in order, before the code is deployed:

```bash
# with .env.local loaded into the shell environment (never print the values; see docs/HANDOVER.md §4)
npx supabase db push --yes --password "$SUPABASE_DB_PASSWORD"
```

Confirm in the Supabase SQL editor:

```sql
select proname, prosecdef from pg_proc where proname like 'post_lab_%' order by 1;
-- 2 rows (post_lab_latest, post_lab_points), prosecdef = false (security invoker)
```

Run the database advisors (Supabase dashboard → Advisors → Security and Performance): no new warnings for the two
functions (each pins `search_path`).

## 1. Layout: 360 / 768 / 1280 × themes, keyboard

Open a Post Lab (Posts tab → a post's flask icon, or its drawer → **Open Post Lab**) in each width (DevTools device
toolbar) and in each theme (Ink, Sunset, Forest, Mono) in light and dark:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| No horizontal page scroll; the scorecard becomes cards on phones | | | |
| Cover left of the header from 768; above it on phones; the long caption scrolls inside its box | | | |
| Verdict chip, delta pills, best/worst badges readable in every theme, light and dark | | | |
| Velocity bars: this post vs the muted median, both visible; two charts side by side from 1280 | | | |
| The Story sequence strip scrolls sideways inside its card, not the page | | | |

Keyboard only (Tab / Shift+Tab / Enter / Esc): back link → tag Edit (dialog opens, Esc closes, focus returns) →
Instagram link → "Followers around this post" → the 30/90 and per reach/per followers toggles (the current one is
announced as current) → "Show the numbers" under each chart → every similar post. Focus is always visible.

## 2. A feed post (image) and a carousel

1. Pick a post older than 7 days. The scorecard's Reach, Views and Interactions must equal the Posts tab's numbers for
   that post (both are the latest snapshot; the Post Lab uses the latest KNOWN value per number).
2. Percentile and "vs median" are filled from 5 earlier posts of the same format with that number; "Your median" says
   how many (n = …). Switch **Last 90**: n grows (up to 90), the URL gets `peers=90`, the scope stays.
3. **Engagement rate per followers**: the URL gets `er=followers`; posts published before the account was connected
   (no follower count that day) say "No follower count".
4. Velocity: a post from the last week shows bars only for the checkpoints already passed ("not yet" in the table for
   the rest); an older post imported in one go shows mostly "no snapshot" (it was never measured at 1 h / 6 h) — that
   is expected, nothing is filled in.
5. Caption lab: the counts match the caption; the with/without table appears only from 20 measured posts of that
   format, else it says how many there are.
6. A carousel shows its slide count on the cover; link taps / profile visits / follows per 1,000 reach are filled for
   posts measured since the 11b deploy, "Not captured" for older ones.

## 3. A Reel

- Watch time panel: average watch, total watch (seconds / minutes / hours) and skip rate with your median; a HIGHER
  skip rate shows a red pill (lower is better).
- Follows per 1,000 reach and Profile visits say **Not reported** with the explanation under the table (Instagram does
  not report them for Reels — `docs/META_PROBE_RESULTS.md`), never 0.

## 4. Stories: a live one and an expired one

1. Post a Story (≥ 5 viewers), wait for a tick, open it from the Stories tab drawer → **Open Post Lab**.
   Header: "Live" badge; back link goes to the Stories tab with the scope. Verdict "Too early" unless it already leads.
2. "What viewers did": forward/back/exit/swipe counts and their share of views; replies.
3. "That day's Stories": the day's Stories in posting order, this one outlined, the others link to their own Post Lab;
   best/worst marks appear from 2 measured Stories.
4. After 24 h the same page shows "Expired", the final numbers, and the full verdict scale.
5. A Story with under 5 viewers: every number says "Under 5 viewers", no verdict, the funnel says why.

## 5. The sample guard

Open the first post of a format (or an account connected recently): no verdict, the line says "Needs 5+ earlier posts of
this format with reach to compare (n so far)", comparisons show "—" and the note under the table explains it.

## 6. Security: nobody but the owner gets rows

- Change the account id in a Post Lab URL to another connected account's id (same media id) → 404. A random media id →
  404. Signed out → `/login`.
- SQL editor (runs as `postgres`). Copy one media id first: `select id from public.media limit 1;`

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","aal":"aal1"}', true);
select count(*) from public.post_lab_latest(array['<media id>']);                               -- 0
select count(*) from public.post_lab_points(array['<media id>'], array[60], array[30]);          -- 0
rollback;

begin;
set local role anon;
select public.post_lab_latest(array['<media id>']); -- ERROR: permission denied for function post_lab_latest
rollback;
```

## 7. Speed

DevTools → Network: opening a Post Lab ("Waiting for server response") should stay within the 1.2 s budget of
docs/RUNBOOK_PERF.md. The plan's dry run measured the two functions on 4,000 Reels × 80 snapshots (320,000 rows) for a
post and its 90 peers: 16–36 ms with Plan 12b's policy rewrite applied, 150–240 ms without it. Note here: ______ ms.

## 8. Known limits (by design)

- Peers are the 30 (or 90) posts of the same format published BEFORE this one; the first posts of a format have none.
- Instagram does not split a single post's reach by followers / non-followers and has no hourly reach; the follower
  curve around a post stays on the Explorer item level ("Followers around this post").
- Posts imported in one go (older than 30 days at connect) have one snapshot: no velocity points and no extras.
- The caption lab shows a pattern in your own posts, not a cause.
- The Stories tab still reads at most 200 Stories per range (Plan 13a); `post_lab_latest` is the upgrade path.

## What to send if it fails

The URL (it holds the toggles and the scope), the width/theme, a screenshot, and for SQL problems the error code
(never paste tokens or the service key).
