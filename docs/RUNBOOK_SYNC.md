# Sync live-verification runbook

Run this once, after: the Meta runbook (`docs/RUNBOOK_META.md`) passes with at least one connected **Creator** account, migration `20261015000001_sync.sql` is applied (step 0), and the app is deployed on its HTTPS URL. Below, `<app-url>` is your `NEXT_PUBLIC_APP_URL` from `.env.local` (production: `https://in2sight.yongsen.space`). Who: owner, or Claude with the owner (Claude never sees the secret or tokens).

Never paste `CRON_SECRET`, tokens or the secret key into chats, screenshots or tickets. Copy `CRON_SECRET` straight from your `.env.local` into the tool that needs it.

## 0. Apply the sync migration (pending)

`supabase/migrations/20261015000001_sync.sql` (tables `sync_state`, `sync_runs`, the sync lease, media and metric tables) is **written but not yet applied** to the Supabase project. Claude applies it with the Supabase CLI and the keys in `.env.local` once the owner says go. To do it yourself:

```bash
npx supabase db push
```

Then run the Supabase security advisor (Dashboard -> Advisors) and confirm there are no new warnings. Until this is applied, the tick answers `202` but every run fails.

## 1. Endpoint answers correctly

```bash
# bash: export CRON_SECRET='<copy from .env.local>'   (PowerShell: $env:CRON_SECRET = '<value>', and type curl.exe, not curl)
curl -i https://<app-url>/api/cron/tick                                          # 401 {"error":"unauthorized"}
curl -i -H "Authorization: Bearer wrong" https://<app-url>/api/cron/tick         # 401
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<app-url>/api/cron/tick  # 202 {"accepted":true}
```

The route accepts `GET` and `POST` identically. Expected: exactly those statuses.

| Status | Meaning |
|---|---|
| `202 {"accepted":true}` | Authorized. The sync runs after the response (up to 60 s); the result is in `public.sync_runs`, not in the response |
| `401 {"error":"unauthorized"}` | Header missing or wrong (check `Bearer`, one space, the exact secret, and that Vercel has the same `CRON_SECRET` as `.env.local`) |
| `503 {"error":"not_configured"}` | `CRON_SECRET`, `SUPABASE_SECRET_KEY` or an `IG_*` variable is missing on Vercel |
| `307` to `/setup` | The Supabase env vars are missing on Vercel |

## 2. The first tick did real work

About a minute after the `202`, in the Supabase SQL editor:

```sql
select started_at, finished_at, summary from public.sync_runs order by id desc limit 1;
select a.username, s.last_success_at, s.last_error_key, s.consecutive_failures, s.daily_done_through, s.last_run
from public.sync_state s join public.accounts a on a.id = s.account_id;
select account_id, count(*), min(day), max(day) from public.account_daily group by 1;
select media_type, count(*) from public.media group by 1;
select count(*) from public.media_metrics;
```

Expected: `summary.accounts[*].outcome` is `ok` or `partial` (partial = the 45 s budget ran out; the next tick continues; `failed` / `needs_reconnect` carry an error key, see `sync_state.last_error_key`). After 1-3 ticks: `daily_done_through` = yesterday (your timezone), `account_daily` spans about 90 days, `media` holds your posts (and `STORY` rows if a story is live), `media_metrics` is non-zero. On **Accounts**, the *Last synced* column shows a time.

## 3. Re-verify the uncertain Meta facts

`lib/instagram/metrics.ts` marks items **UNCERTAIN**. Check each against the live account:

```bash
npm run record:fixtures
```

It reads the first active account's token from the database with the secret key in `.env.local` (the token is never printed or written to disk), calls every endpoint the sync uses, and prints `[ok]` / `[!!] ... code N/sub` per call. It makes real network calls only when you run it. Then:

| Uncertain item | How to confirm | If wrong |
|---|---|---|
| `caption`, `media_product_type` on `/me/media` (docs say Facebook-Login-only) | `media-page-1` is `[ok]` and the file shows both fields | `[!!] code 100`: delete both from `MEDIA_FIELDS` (the parser falls back) |
| `/me/stories` with Instagram Login | `stories` is `[ok]` (post a test story first) | report it: Stories capture then needs a different source |
| `follows_and_unfollows` -> `FOLLOWER` = follows, `NON_FOLLOWER` = unfollows | compare `account-follows.json` with the Instagram app's follows/unfollows for that day | swap the values in `FOLLOW_TYPE` |
| `online_followers` still served; hour base | `online-followers` is `[ok]` with 24 keys (needs 100+ followers) | if `code 100`: remove the call from the audience job |
| Day boundary of account insights | `account_daily.reach` for yesterday is about the Instagram app's figure for yesterday | if consistently off by a day, note it in SPEC §7 and adjust `dayRangeSec` callers |
| 90-day backfill reach | `select min(day) from account_daily` is about 90 days back | if older days were skipped, set `BACKFILL_DAYS` to what works |
| Deleted media = code 100 / subcode 33 | delete a test post, wait one hour, check `media.gone_at` is set | update `IG_ERROR.objectMissingSubcode` |

## 4. Record real fixtures

The same command wrote real, redacted responses into `tests/fixtures/instagram/*.json` (errors go to `*.error.json` and never overwrite a good fixture). Then:

1. Open each changed file: no `access_token` value (only `REDACTED`), no caption you do not want in git (edit captions to `"x"` if needed). Each file's `_source` line mentions the Graph path, which can include a media id; that is fine to commit, but remove it if you prefer.
2. Delete any `*.error.json` once handled.
3. `npm test`. If a parser test fails because real data differs from the hand-written fixture, fix the **expected values** in the test to match the real response (the parser stays unless the shape changed).
4. Commit: `test: recorded Instagram fixtures`.

## 5. Scheduler: cron-job.org (recommended)

Free, 1-minute granularity, custom headers, failure e-mails, execution history.

1. Sign up at https://cron-job.org -> **Cronjobs -> Create cronjob**.
2. **Common** tab:
   - Title: `in2sight tick`
   - URL: `https://<app-url>/api/cron/tick`
   - Execution schedule: **Every 30 minutes** (or *Custom*: minutes `7,37`, every hour/day/month, to stay off the busy top of the hour)
   - Notify me when: execution **fails** (after 2 failures), and when it **succeeds again after failing**; also when the job is **disabled because of too many failures**
3. **Advanced** tab:
   - Request method: `GET`
   - Headers: add `Authorization` with value `Bearer <CRON_SECRET>` (the literal word `Bearer`, a space, then the value copied from your `.env.local`)
   - Timeout: `30` seconds (free-tier maximum; the endpoint answers in well under a second)
   - Treat redirects (3xx) as success: **off** (a redirect means a misconfiguration)
   - Save responses in job history: **on**
4. **Test run** -> expect `202` and body `{"accepted":true}`. Save.
5. After an hour: the job history shows `202`s; `select count(*) from public.sync_runs where started_at > now() - interval '1 hour'` is 2.

Vercel: the production domain must not be behind Deployment Protection (default Vercel settings protect previews only). Point cron-job.org at the production domain, not a preview URL.

## 6. Fallback scheduler: Supabase pg_cron + pg_net

Use this only if cron-job.org is unavailable. Run in the SQL editor (replace `<app-url>`; paste the secret only into the vault call, from `.env.local`, never into chat):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select vault.create_secret('<CRON_SECRET>', 'in2sight_cron_secret');

select cron.schedule('in2sight-tick', '7,37 * * * *', $$
  select net.http_get(
    url := 'https://<app-url>/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'in2sight_cron_secret')),
    timeout_milliseconds := 10000
  );
$$);
```

Check: `select * from cron.job_run_details order by start_time desc limit 5;` (status `succeeded`) and `select status_code from net._http_response order by created desc limit 5;` (`202`). Remove with `select cron.unschedule('in2sight-tick');`. Run only one scheduler at a time (two would be harmless thanks to the per-account lease, but wasteful).

## 7. Failure drills

| Drill | Expected |
|---|---|
| Run the tick twice within a few seconds (curl twice) | Second run's summary shows `locked` or `idle` for each account; no duplicate rows |
| In Meta's app dashboard remove one tester account (or revoke the app in that Instagram account) and run a tick | That account turns **Reconnect** with "Instagram rejected the access token..."; the other accounts still sync |
| **Accounts -> ... -> Sync now** on an active account | Button finishes within a minute; *Last synced* updates |

## What to send me if it fails

The `sync_runs.summary` JSON of the failing run, the `[!!]` lines from `npm run record:fixtures`, and the cron-job.org history status codes. No tokens, no secret.
