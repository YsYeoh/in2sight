# Runbook — Goals and the weekly / monthly digest (Plan 17d)

Live checks for the **Plan** page (`/plan/digest`, `/plan/goals`). Nothing here has been tried on real data yet: the code
was tested with fakes and the migration on PGlite only (plan `docs/superpowers/plans/2026-11-01-17d-goals-digest.md`,
"Scratch-run result"). Do the steps with the owner (2FA login, real accounts) on the deployed app (`<app-url>`). Report
yes/no and numbers only; never paste captions or handles into a chat or an issue.

## 0. The migration (apply BEFORE deploying; the owner says go)
`supabase/migrations/20261103000001_goals.sql` adds the table `goals` (owner-only RLS, deleted with its account). It was
applied 2026-11-04 (dry-run listed exactly this file; `migration list` 19 / 19; anon probe 401 / 42501; advisors unchanged). Nothing existing is dropped. Supabase CLI 3.x defaults to the local Docker stack, so every
`sb.mjs` command carries `--remote` (`db query` against production needs an extra consent flag and is not used).
```
node --env-file=.env.local scripts/sb.mjs migration list --remote        # only 20261103000001 pending (plus any earlier pending file); nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs table:goals              # before: 404 PGRST205 (absent)
node --env-file=.env.local scripts/sb.mjs db push --remote --dry-run     # exactly the pending file(s)
node --env-file=.env.local scripts/sb.mjs db push --remote --yes
node --env-file=.env.local scripts/sb.mjs migration list --remote        # N local / N remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs table:goals              # after: 401 with code 42501 (exists, anon denied)  (L3)
```
Before `db push`, the dry-run must list exactly the files you expect; if it lists an older migration too, stop and ask
the owner.

Not checked from the CLI: that the signed-in owner can read and write `goals` (RLS passes `is_owner()`); the first goal
saved in section 3 is that check.

Until it is applied: Goals shows "Goals need a database update", the digest has no goals block, and Settings → Data &
privacy → Download all fails on the `goals` file with the usual export error.

## 1. Navigation (360 / 768 / 1280 px, light and dark of every theme)
1. Sidebar (desktop), icon rail (tablet) and the phone bottom bar show **Plan** between Explorer and Settings; the phone
   bar has 7 items and every label is readable at 360 px.
2. `/plan` opens `/plan/digest`; the Digest / Goals underline tabs switch sections; `/plan/x` is a 404; Plan opens in a
   shell tab titled "Plan" and stays inside the frame.
3. A dirty goals form asks before switching to Digest; reload asks too.

## 2. Digest = Overview (L1)
1. Open `/plan/digest` (last complete week). Note the six KPIs of one account.
2. Open Overview with the same days: `/overview?from=<first day>&to=<last day>`. Every KPI and its change must match.
3. Month: pick Month (last complete month) and repeat with `?from=<1st>&to=<last day>`.
4. Next on the running week: "still running" shows; the comparison covers the same number of days of the week before.
5. Best / weakest posts: open one; its Post Lab reach equals the digest number (latest snapshot). Posts under 7 days
   old say "still gaining reach". With fewer than 7 measured posts there is no weakest list (the line says why).
6. Week start: switch Settings → Language & formats → week starts on Sunday; the default week shifts by one day.

## 3. Goals (L3)
1. Set for one account: followers = current + 100 by a day 60 days ahead; average reach = a round number; posts per
   week = 3. Save → "Goals saved."; reload: the values stay; the progress lines show a status word.
2. Followers: the "straight line" number today ≈ the current count (set today); the projection says Low or Medium and
   "not enough history" when the account has under 14 days of follower counts. Never "High".
3. Clear the posts-per-week field, save: that goal disappears from the digest's "Goals now".
4. Wrong values: a target of 0 or 1.5, a followers target without a date, a followers date that is not after today: the
   form says some values are not valid (and lists the rules) and nothing is saved.
5. A followers goal whose due day is today or has passed (use one you set earlier, or wait for the day): it shows
   "Missed" or the last status, you can still change posts per week or clear a goal and save; only changing the followers
   target or day asks for a day after today.
6. Settings → Data & privacy → Download all: `goals.json` is one of the files; it holds only your targets.

## 4. Speed (L2)
DevTools → Network → the `/plan/digest` document → Server-Timing; warm load ≤ 1.2 s p75 with two accounts (the same reads
as Overview plus one small goals read). Record the numbers here.

## 5. Delete
Settings → Data & privacy → Delete all data (only when the owner wants everything gone): `goals` is emptied with the
accounts (cascade). Archive → delete permanently on one account removes only that account's goals.

## Results
| Step | Date | Result |
|---|---|---|
| §0 | | |
| §1 | | |
| §2 (L1) | | |
| §3 (L3) | | |
| §4 (L2) | | |
