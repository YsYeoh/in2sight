# Runbook: Data & privacy (Plan 16c) — live checks

Plan 16c is code complete on local `main`, NOT pushed. Nothing here has been verified live. Do it with the owner, signed in with 2FA, on the deployed app, in this order. Report yes/no and counts only (file contents hold other people's names: never paste them into a chat or an issue).

## 0. The migration — on the owner's go-ahead, before relying on Storage used or Delete all
`supabase/migrations/20261031000001_data_privacy.sql` adds two functions and nothing else: `data_usage()` (owner-only sizes, SECURITY DEFINER) and `delete_all_data()` (executable by the service role only). It is NOT applied.
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect 20261031000001 pending (and 20261030000001 if 16a's is still pending), nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs rpc:data_usage:'{}'          # before: 404 PGRST202 (does not exist)
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file(s)
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # expect N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs rpc:data_usage:'{}'          # after: 401 with code 42501 (exists, anon is denied)
```
Then, Supabase dashboard → SQL editor (read-only queries; the owner runs them):
```sql
select r, has_function_privilege(r, 'public.delete_all_data()', 'execute') as can_delete,
          has_function_privilege(r, 'public.data_usage()', 'execute') as can_read_usage
  from unnest(array['anon', 'authenticated', 'service_role']) as r;
```
Expected: `anon` false / false, `authenticated` **false** / true, `service_role` true / true. If `authenticated` can execute `delete_all_data`, STOP and report (the password re-check would then be UI-level only). Do NOT run `select public.delete_all_data()` in the SQL editor: it deletes everything.

Without the migration: Storage used says "Storage figures need a database update", Delete all answers "This needs a database update first. Nothing was deleted.", the export works.

## 1. Storage used (L2: the definer reads Storage)
1. Settings → Data & privacy: four cards (What in2sight stores, Storage used, Export your data, Delete all data).
2. Storage used shows the database total, five groups with rows and sizes, and "Cover images" per account (`@username`, image count, size). Compare: Supabase → Reports / Database size (about the same as "Database in total"); Storage → `covers` bucket size ≈ the sum of the cover lines. If the whole card says "needs a database update" although §0 passed: the function cannot read `storage.objects` (L2): report the error from Supabase → Logs → Postgres.
3. A row count "—" means the table was never analysed: normal for a new, small table.
4. A line "Not linked to an account" = cover images of an account that no longer exists (left by an interrupted delete or a sync that was mid-run): Delete all data removes them; nothing else reads them.

## 2. Export your data (L1: keyset paging on the real PostgREST)
1. Leave "Include other people's data" unticked → "Download all files". The browser may ask once to allow several downloads: allow. Progress "Downloading file 3 of 18…", then "18 files downloaded."
2. The download folder has 18 files `in2sight-<table>-<date>.json`, NO `comments` and NO `follower_exports` file.
3. **No secrets:** in PowerShell in the download folder: `Select-String -Path in2sight-*.json -Pattern 'access_token','IGAA','EAA','p256dh','refresh_token' -List` → no output. (`api_snapshots` has an `endpoint` field: an API path without a token, by design.)
4. **Paging is complete (L1).** Pick the biggest file (usually `media_metrics` or `follower_snapshots`; it must have more than 1,000 rows to prove anything): `(Get-Content in2sight-media_metrics-*.json -Raw | ConvertFrom-Json).Count` and, SQL editor, `select count(*) from public.media_metrics;` → the same number (a sync may add a few rows in between: run both within a minute, or compare again). Also check no duplicates: `$r = Get-Content in2sight-media_metrics-*.json -Raw | ConvertFrom-Json; ($r | ForEach-Object { "$($_.media_id)|$($_.captured_at)" } | Sort-Object -Unique).Count` equals the count. Different numbers = L1 failed: stop and report (the export is then not trustworthy).
5. Each file opens as valid JSON (`ConvertFrom-Json` above did not error).
6. Single files: open "Single files", download `comments` (marked "Other people's data"): one file. Tick the box and "Download all files" again: 20 files. **Delete the files with other people's data when done.**
7. Time: DevTools → Network, the slowest `/api/export/data?table=…` request: note its time. Over 40 s = close to the 50 s budget: report it (the plan's `?after=` follow-up).
8. Signed out (private window), open `/api/export/data?table=media` → no file (sign-in page or 401). `/api/export/data?table=account_tokens` signed in → `{"error":"bad_params"}`.

## 3. Delete all data (DESTRUCTIVE)
### 3.1 Refusals (safe: nothing is deleted)
1. "Delete all data…" opens a dialog (bottom sheet on a phone). "Delete everything" stays disabled until `DELETE` is typed exactly (`delete`, ` DELETE` keep it disabled).
2. A wrong password + `DELETE` → "The password is wrong." on the password field; the dialog stays open; nothing changed (Accounts page still lists every account).
3. Five wrong passwords → "Too many attempts. Wait a few minutes and try again." (a cookie limit shared with Change password; a private window resets it: expected).
4. Cancel / Esc closes the dialog; reopening shows empty fields and no old error.
### 3.2 Before a real delete
1. Export first (§2) if you want a copy. 2. Decide whether you are done with in2sight's Instagram access (§3.4).
### 3.3 The real delete (only when you want everything gone; L3: pg-safeupdate)
1. Password + `DELETE` → "All data of N accounts was deleted." The dialog closes.
2. Accounts page: empty (Connect again works and starts a NEW history). Overview: the empty state. Settings → Data & privacy → Storage used: groups near zero rows, "No cover images are stored." Supabase → Storage → `covers`: empty.
3. Kept: you are still signed in, 2FA still asked at the next sign-in, theme / language / alert rules unchanged, push notifications still allowed on this device.
4. "Some cover images could not be removed yet…" → run Delete all data again after a minute (it deletes nothing else and finishes the images).
5. An error "Something went wrong…" → nothing was deleted from the database (one transaction); report the time; check Supabase → Logs → API for `POST /rest/v1/rpc/delete_all_data` and its status (a 400 mentioning "DELETE requires a WHERE clause" would mean L3 failed: the code already sends `where true`, so report it).
6. Audit: Supabase → Logs → API shows the `POST /rest/v1/rpc/delete_all_data` line with the time (this is the record of the delete); Vercel → Logs shows the POST to `/settings/data`.
### 3.4 Instagram (L5)
in2sight does not revoke its Instagram access itself. In the Instagram app: Settings → Website permissions → Apps and websites (labels may differ) → remove in2sight. Meta then calls the app's deauthorize URL: it finds no account and does nothing (check Vercel → Logs: a 200 on `/api/instagram/deauthorize`, nothing else).

## 4. Inside a tab frame and on a phone
1. Settings → Data & privacy opened as a shell tab: Download all files works from inside the frame (files arrive); the delete dialog works.
2. 360 / 768 / 1280 px, light and dark of two themes: no horizontal scroll; long Chinese table names wrap; the "Download" buttons wrap under their label on a phone; the dialog is a bottom sheet below 768 px.

## 5. Privacy and logs
- Vercel → Logs: only request lines (`GET /api/export/data?table=…`, the settings POST); no row content, no names, no error objects.
- The export files hold your data and, if chosen, other people's names: keep them private; delete them when done.

## Known limits (by design)
No zip and no cover images in the export; one table per request within 50 s; row counts are estimates; no per-account database size; the app does not revoke the Instagram grant; a sync that is mid-run during a delete can leave one cover image ("Not linked to an account"; the next run removes it).

Record the outcomes here and tick `docs/TODO.md` §6q only after the owner has looked.
