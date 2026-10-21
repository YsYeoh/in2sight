# Runbook — Followers by name (Plan 15b)

Live checks for the owner (with the assistant). Everything was tested with fakes only; the Instagram export format is
UNCONFIRMED until §2 passes on a real export. **Privacy first:** the follower lists are other people's personal data.
Never paste usernames, export files or screenshots of the lists into chats, issues or logs; the checks below are
designed to report counts and structure only.

**Status (2026-10-28):** Plan 15b is code-complete on local `main`, NOT pushed, and NOTHING in it is verified live.
The migration `supabase/migrations/20261028000002_follower_exports.sql` is NOT applied to the live database (apply it
only on the owner's go-ahead, BEFORE deploying code that needs it). The export-file format assumptions (folder names,
file names, JSON shapes) can only be confirmed with a real export: §2 is the gate. Plans 14a-14c are pushed
(`origin/main` `b8f723c` + docs `0cee097`) and the 14b migration is applied live (2026-10-21). Plan 15a (Growth) is on
local `main`, not pushed, and has no migration. Account tab order is now Overview, Growth, Posts, Stories, Followers.

## 0. The migration (apply BEFORE or right after deploying; the owner says go)

`supabase/migrations/20261028000002_follower_exports.sql` adds ONE table, `follower_exports` (owner-only RLS, deleted
with its account). Until it is applied, the Followers tab shows the guide and "Followers needs a database update" (no
upload button), and the upload answers `notReady`; nothing else changes. Apply:

```bash
# with .env.local loaded into the shell environment (never print the values; see docs/HANDOVER.md §0 "How it was applied")
npx supabase migration list            # expect only 20261028000002 pending, nothing remote-only (Plan 15a has no migration)
npx supabase db push --dry-run --password "$SUPABASE_DB_PASSWORD"   # expect exactly the pending file
npx supabase db push --yes --password "$SUPABASE_DB_PASSWORD"
```

Confirm in the Supabase SQL editor:

```sql
select relname, relrowsecurity from pg_class where relname = 'follower_exports';            -- 1 row, true
select polname, polcmd from pg_policy where polrelid = 'public.follower_exports'::regclass;  -- follower_exports_owner_all, *
select confdeltype from pg_constraint where conrelid = 'public.follower_exports'::regclass and contype = 'f';  -- c (cascade)
```

Then Supabase dashboard → Advisors → Security and Performance: no new warning for `follower_exports`.

## 1. Layout: 360 / 768 / 1280 × themes, keyboard

Account page → Followers, in each width (DevTools device toolbar) and each theme in light and dark:

| Check | 360 | 768 | 1280 |
|---|---|---|---|
| Tabs Overview / Growth / Posts / Stories / Followers fit or scroll sideways without a visible bar | | | |
| The guide opens and closes; the seven steps are readable | | | |
| Toolbar wraps; search, the two selects and the buttons are the same height; no sideways page scroll | | | |
| The five list tabs scroll sideways on a phone; the active one is underlined | | | |
| The list is cards on a phone, a table from 768; page navigation wraps and stays centred | | | |
| Upload opens as a bottom sheet (phone) / a dialog (wider); Esc and Cancel close it; focus returns to the button | | | |
| No range bar on the Followers tab | | | |

Keyboard only: Tab through the guide summary → search → Snapshot → Compare with → Export list → Upload export → the
list tabs (arrow keys move, Enter opens) → the profile links → the page buttons → the Delete buttons.

## 2. Confirm the export format on a REAL export (gate: do this before relying on the feature)

1. Follow the guide in the tab on the phone (the owner's account). Note any step whose wording differs from the guide
   (Instagram renames menus) and tell the assistant the exact labels (en and, if used, zh-CN).
2. Unzip the download. Note the folder path and the file names under `connections/followers_and_following/` (or
   wherever they are). Expected: `followers_1.json` (+ `followers_2.json` …), `following.json`.
3. Print the STRUCTURE only (no usernames) of each file — run this in a terminal in the unzipped folder (Node is
   installed with the app):

```bash
node -e "for (const f of process.argv.slice(1)) { const j = JSON.parse(require('fs').readFileSync(f, 'utf8')); const list = Array.isArray(j) ? j : Object.values(j)[0]; const e = Array.isArray(list) ? list[0] : null; const s = e && Array.isArray(e.string_list_data) ? e.string_list_data[0] : null; console.log(f, '| root:', Array.isArray(j) ? 'array' : 'object keys=' + Object.keys(j).join(','), '| entries:', Array.isArray(list) ? list.length : '?', '| entry keys:', e ? Object.keys(e).join(',') : '-', '| title empty:', e ? e.title === '' : '-', '| item keys:', s ? Object.keys(s).join(',') : '-', '| timestamp type:', s ? typeof s.timestamp : '-'); }" followers_1.json following.json
```

   Expected (the plan's assumptions E3/E4): followers = `root: array` (or `object keys=relationships_followers`),
   item keys `href,value,timestamp`, timestamp `number`; following = `object keys=relationships_following`, item keys
   `href,value,timestamp` or `href,timestamp` with a non-empty title. Send the assistant these lines (they contain no
   names). Anything else: the parser needs a new fixture (lib/followers/parse.ts `entryPerson` / `kindOf`).
4. Upload the files in the tab. The preview's follower count should be close to the profile's follower number on
   Instagram (people who followed or left since the export was made explain a small gap); "entries are not a valid
   username" should be 0 or tiny. Note both numbers (counts only).

## 3. Upload and errors

- Choose the `.zip` itself → "is a zip file. Unzip it first". Choose a `.html` file → "comes from an HTML export".
  Choose `following.json` alone → "Add followers_1.json". Choose `recently_unfollowed_profiles.json` with the
  followers file → listed under "Not needed, skipped".
- DevTools → Network on Upload: ONE `POST /api/accounts/<id>/followers`, request size well under 4 MB (≈ 25–47 bytes
  per person), answer 201; the request body contains `followers` pairs and NO `instagram.com` links.
- Upload the same export again with another date: the snapshot list shows both; New followers and Unfollowed you are
  empty when comparing them (same people).

## 4. The lists

1. With two real exports some days apart: New followers and Unfollowed you list the changes, each with "Snapshot-based".
   Spot-check two names per list on Instagram (do not paste them anywhere).
2. Don't follow you back / You don't follow back / Mutuals: the three add up — Mutuals + You don't follow back = the
   newer snapshot's followers; Mutuals + Don't follow you back = its following.
3. Search narrows the list as you type (after a short pause), the chip removes it; pages: First / Previous / Next /
   Last keep the search; `page=999` in the URL shows page 1.
4. Snapshot / Compare with: pick an older pair; the dates in the hint follow; choosing them "the wrong way round"
   still compares older → newer.
5. Export list: the .xlsx opens in Excel / Numbers / LibreOffice: the list sheet (Username, the date column, Profile
   link) and an About sheet with both dates and the snapshot-based note.
6. Delete a snapshot: it asks first; afterwards the list and the selects no longer show it.

## 5. Privacy and security (run all; report only yes/no and counts)

```sql
-- sizes: about 1 MB or less per 50,000 followers
select taken_on, follower_count, following_count, pg_column_size(followers) + pg_column_size(followers_at) + coalesce(pg_column_size(following) + pg_column_size(following_at), 0) as bytes from public.follower_exports order by taken_on desc;

-- nobody but the owner gets rows
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","aal":"aal1"}', true);
select count(*) from public.follower_exports;   -- 0
rollback;
begin;
set local role anon;
select count(*) from public.follower_exports;   -- ERROR: permission denied for table follower_exports
rollback;
```

- Vercel → the project → Logs, the hour of an upload and an export: search for one follower's username you know is in
  the file → **no match** (only the fixed lines `followers upload failed` / `followers export failed` may ever appear).
- `select count(*) from public.sync_runs where summary::text ilike '%<a known follower username>%';` → 0 (the sync
  never sees these lists; type the name only into the SQL editor, never into a chat).
- The account Excel/PDF exports (Export dialog) contain no follower names (only counts, as before).
- Delete all data: when an ARCHIVED test account is deleted permanently (Accounts → Delete all data), its snapshots
  go with it: `select count(*) from public.follower_exports where account_id = '<that id>';` → 0. Do not delete a
  real account for this check; it is pinned by the migration test (`on delete cascade`) if no test account exists.

## 6. Speed (the biggest account)

DevTools → Network on a list change (another tab, a search, a page) for the account with the most followers: "Waiting
for server response" within the 1.2 s budget of docs/RUNBOOK_PERF.md. Note: ____ ms. Each change re-reads the two
compared snapshots (~1–2 MB from the database for 50,000 followers); if it is slower than the budget, tell the
assistant (the upgrade is a per-snapshot cache or an SQL diff function).

## 7. Known limits (by design)

- Only by-name route: no API gives follower names; nothing is crawled. Lists are as good as the two files.
- Snapshot-based: someone who followed and unfollowed between two exports appears in neither list; renamed and
  deactivated accounts appear as "Unfollowed you".
- At most 50,000 followers and 10,000 following per export; at most 60 snapshots per account. No .zip upload yet.
- No reminder notification; only the quiet "export is N days old" line after 30 days.

## What to send if it fails

The URL (without tokens), the width and theme, the step, the error text shown, counts (never names), and for §2 the
structure lines printed by the command.
