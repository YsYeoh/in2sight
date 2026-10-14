# Meta / Accounts live-verification runbook

Run this once, after: the Supabase project exists with **both** migrations applied (`20261014000001_owner_and_profiles.sql`, `20261014000002_accounts.sql`), `.env.local` is filled (Supabase + `IG_*`), the Meta app is set up per `META_SETUP.md`, and the app is deployed on an HTTPS URL. The code and tests for the Accounts page and the Instagram connect flow are done; these steps prove them against the real services. Who: owner, or Claude with the owner at the browser (Instagram login cannot be done by Claude).

Never paste tokens, the app secret or cookies anywhere. When something fails, send the items under "What to send me if it fails" at the end.

## Before you start

- Use the **deployed HTTPS URL** registered in Meta as the redirect (`<app-url>` below). Meta's docs do not confirm `http://localhost` is accepted.
- Each Instagram account to connect must be a **Creator** (or Business) account and be added to the Meta app (`META_SETUP.md` Parts 1 and 7). Have one **personal** account ready for the negative check, or skip that line.
- Use a separate browser profile or private window per Instagram account: Instagram logs in as whichever account that browser is already signed in to. (in2sight asks Instagram to re-authenticate each time.)

## Steps

| # | Do | Expected |
|---|---|---|
| 1 | `npm run check:env` (add `-- --only=app,supabase,security,meta` to pick groups). | Every variable reports `[ok]`; no values are printed. No `IG_REDIRECT_URI must equal NEXT_PUBLIC_APP_URL + /api/instagram/callback` error. |
| 2 | Open `<app-url>/`, sign in (password + 2FA code). In Meta's dashboard confirm the saved **OAuth redirect URI** is exactly `<app-url>/api/instagram/callback` (no trailing slash), and the Deauthorize / Data deletion callback URLs are `<app-url>/api/instagram/deauthorize` and `<app-url>/api/instagram/delete`. | You land on `/overview`. Meta lists exactly those three addresses. |
| 3 | Go to **Accounts** → **Add account**. Leave *Group* empty. Click **Continue with Instagram**. On Instagram's page log in as a **Creator** account and approve both permissions (`instagram_business_basic`, `instagram_business_manage_insights`). | You are sent back to `<app-url>/accounts?connected=<username>`; the notice reads "Connected <username>". The account appears under **Isolated accounts** with status **Active** and a token meter of about **60 days left** (the meter rounds up, so 60 or 59). The connected date is today in your date format. |
| 4 | Repeat step 3 with a **second** account, typing the group **Brand X** in the dialog first. | Redirect to `/accounts?connected=<username>`. The account sits under a **Brand X** heading; the first account is still under *Isolated accounts*. |
| 5 | Negative checks (a, b, c, d below). | Each shows the exact message listed and creates no row. |
| 6 | Archive, reconnect, restore, delete (steps 6a-6e below). | See below. |
| 7 | Security: RLS deny on `account_tokens` (7a-7c below). | See below. |
| 8 | Webhooks: forged callbacks (step 8 below). | See below. |
| 9 | Token expiry meter (step 9 below). | See below. |
| 10 | Group edit (step 10 below). | See below. |
| 11 | Hostile display name (step 11 below). | See below. |
| 12 | Responsive and theme pass (step 12 below). | See below. |

### 5. Negative checks

| | Do | Expected |
|---|---|---|
| 5a | **Add account** → *Continue with Instagram* → on Instagram press **Cancel / Not now** instead of approving. | Back on `/accounts?error=access_denied` with the red notice "Instagram access was not granted." No new row. |
| 5b | **Add account** with a **personal** Instagram account. (If Instagram itself refuses before redirecting, that is also a pass; there is then nothing to check.) | `/accounts?error=not_professional`: "That account is not a Creator or Business account. Switch it in Instagram first." No new row, and no `account_tokens` row either. |
| 5c | While signed in, open `<app-url>/api/instagram/callback?code=x&state=y` directly. | `/accounts?error=state_mismatch`: "The sign-in session expired. Please try again." No call is made to Instagram. |
| 5d | Signed out (private window), open `<app-url>/api/instagram/connect`. | A 307 redirect to `/login` from the proxy (the same for `/api/instagram/callback`). The JSON `401 {"error":"unauthorized"}` only appears for a signed-in user who is **not** the owner, which cannot normally be tested live; do not treat the missing 401 as a failure. |

Behavioural notes (not failures):
- A signed-in owner whose 2FA code is still pending is sent to `/login/verify` when they hit `/connect` or `/callback`. If that happens mid-flow the one-time OAuth code is lost. Verify 2FA and click **Add account** again.
- The sign-in state cookie lasts a few minutes. If you wait too long on Instagram's page, the callback reports `state_mismatch`; just retry.

### 6. Archive, reconnect, restore, delete

6a. Open the row's **Account actions** menu → **Archive** → confirm. Expected: the account leaves its list and appears under **Archived (1)** with a status of *Archived*. Its history is kept.

6b. Note the row identity before reconnecting. In the Supabase SQL editor (runs as the database owner):

```sql
select id, ig_user_id, username, status, group_name, archived_at, token_expires_at
from public.accounts order by created_at;
```

Write down the archived account's `id`.

6c. **Reconnect the archived account:** **Add account** → *Continue with Instagram* → log in as that same Instagram account. Expected: `/accounts?connected=<username>`, the account is back in its **original group** (the dialog's group field was left empty, which keeps the existing group), status **Active**, about 60 days. Re-run the SQL from 6b: the `id` is **unchanged**, `status = active`, `archived_at` is null, and there is **exactly one row** for that `ig_user_id`:

```sql
select count(*) from public.accounts where ig_user_id = '<ig_user_id>'; -- 1
```

6d. **Restore:** archive the account again, then in **Archived** press **Restore**. Expected: back in its group, `status = active`, same `id`.

6e. **Delete permanently:** archive the account again → in **Archived** press **Delete permanently** → the dialog asks you to type the username; the button stays disabled until it matches exactly → confirm. Expected: the row disappears. In SQL, both of these return 0 rows for the deleted `id` (the token row is removed by `on delete cascade`):

```sql
select id from public.accounts where id = '<id>';
select account_id from public.account_tokens where account_id = '<id>';
```

An **active** account has no *Delete permanently* action (only archived ones do). Reconnect it afterwards with step 3 if you want it back.

### 7. RLS deny on `account_tokens`

7a. Security advisor: run `get_advisors` (type `security`) with the connected Supabase tool, or Dashboard → *Advisors → Security*. Expected: no "RLS disabled" finding for `accounts` or `account_tokens`, and no "policy exists but RLS disabled" finding.

7b. The secret (service-role) key can read it; SQL editor: `select count(*) from public.account_tokens;` returns the number of connected accounts (an integer, no error). Do not `select access_token` into a chat or screenshot.

7c. A signed-in session cannot read it. Take any valid signed-in user JWT (browser devtools → Application → Cookies → the `sb-…-auth-token` cookie, **keep it private**) and the **publishable** key, then:

```bash
curl -i "https://<project-ref>.supabase.co/rest/v1/account_tokens?select=account_id" \
  -H "apikey: <publishable key>" -H "Authorization: Bearer <access_token from that cookie>"
```

Expected: HTTP 401/403 with a permission error (`permission denied for table account_tokens`, the table privileges are revoked) or at most an empty array `[]`; never any rows and never an `access_token`. The same call with only the publishable key (anon) gives the same result. For contrast, `.../rest/v1/accounts?select=id,username` with the owner's session returns your accounts, and with the anon key alone returns `[]`.

### 8. Meta callbacks

```bash
curl -i -X POST -d signed_request=x <app-url>/api/instagram/deauthorize
curl -i -X POST -d signed_request=x <app-url>/api/instagram/delete
```

Expected: `HTTP 400` with `{"error":"invalid_request"}` for both (no session is needed; these endpoints are authenticated by the HMAC on the signed request). A `503 {"error":"not_configured"}` means `IG_APP_SECRET` (or, for `/delete`, `NEXT_PUBLIC_APP_URL`) is missing on the server.

Genuine delivery: in Instagram, remove the app for a **test** account (Settings → Apps and websites → remove in2sight) or press *Test* on the callback URL in the Meta dashboard if offered. Expected after Meta calls `/deauthorize`: that account's row on `/accounts` shows **Reconnect** (status `needs_reconnect`, `last_error = 'deauthorized'` in SQL). Reconnecting it with step 3 returns it to **Active** on the same row. If Meta does not call the endpoint, mark the check "not exercised"; it is not a blocker.

Notes about the data-deletion callback (`/delete`):
- It answers `200 {"url": "<app-url>/accounts", "confirmation_code": "<hex>"}`. That status URL is **behind login**, so Meta/Instagram users cannot open it; Meta only stores it, and you are the only user.
- Deletion is **flag-only**: the account is marked `needs_reconnect` (reason `deletion requested`) and nothing is erased. To really remove the data, archive the account and press *Delete permanently* (step 6e).
- `/delete` leaves the `account_tokens` row in place until you delete the account (Plan 5 may drop it when sync marks the account unusable).

### 9. Token expiry meter

After step 3 the meter reads about 60 days. To exercise the other states without waiting, set the stored expiry from the SQL editor (this only moves the displayed copy; the real token is untouched):

```sql
update public.accounts set token_expires_at = now() + interval '5 days'  where username = '<username>';
```

Reload `/accounts`. Expected: "5 days left" with the status badge **Expiring** (7 days or fewer counts as expiring). Then `now() - interval '1 day'`: the meter says **Expired** and the badge says **Reconnect**. Restore the real value by reconnecting (step 3) or by setting `now() + interval '60 days'`.

### 10. Group edit

On a grouped account open **Account actions** → **Edit group**, change *Brand X* to *Brand Y*, **Save**. Expected: the account moves under a **Brand Y** heading with no page error; an empty group makes it an isolated account again. A name longer than 40 characters shows "That group name is not valid (max 40 characters)." and changes nothing. Groups are listed alphabetically with *Isolated accounts* last.

### 11. Hostile display-name rendering

Group names are free text typed by the owner, so use one to prove they render as text. **Edit group** on any account and save the group `<img src=x onerror=alert(1)>`. Expected: the literal text `<img src=x onerror=alert(1)>` appears as the group heading and badge; no alert fires and no broken image appears. Change the group back afterwards. (Instagram display names and usernames go through the same React text rendering.)

### 12. Responsive and theme pass (manual, in a browser)

Open `/accounts` with some accounts connected, at **360 px**, **768 px** and **1280 px+** wide (devtools device toolbar). In each of the four themes (Ink, Sunset, Forest, Mono) in **light and dark** (Settings → Appearance). Expected:
- No horizontal page scroll at any width; the dialogs (Add account, Edit group, Archive, Delete) open as bottom sheets on phone width and as centred dialogs on larger screens.
- At 360 px accounts show as cards, at 768 px and up as a table; the token meter, badges and the row action menu stay inside their container and are tappable.
- Text, badges and notices are readable in every theme/mode (no unreadable foreground on background, no raw colours standing out).
- The *Archived* list is a single simple list with **Restore** and **Delete permanently** buttons.

## What to send me if it fails

Send only these (no tokens, secret, cookies or screenshots with them):
- The step number and the exact text on screen.
- The `error=<key>` shown in the URL after the redirect (`access_denied`, `state_mismatch`, `missing_code`, `exchange_failed`, `profile_failed`, `not_professional`, `save_failed`, `not_configured`), or the HTTP status and JSON body for the curl checks.
- The output of `npm run check:env` (variable names and `[ok]`/error only).
- The saved OAuth redirect URI as shown in Meta, and the value of `NEXT_PUBLIC_APP_URL` (both are not secret).
- For database checks: the rows from the SQL in 6b with `ig_user_id` blurred if you prefer (never `access_token`), and the security advisor's findings.
- Vercel function logs for `/api/instagram/*` around the time of the failure (they do not contain tokens).

## Key to the error keys

| Redirect key | Meaning | First thing to check |
|---|---|---|
| `access_denied` | You cancelled, or Instagram refused consent. | Retry and approve both permissions. |
| `state_mismatch` | The one-time sign-in state cookie did not match (expired, different browser/domain, or a hand-made URL). | Retry from **Add account** on the same URL registered in Meta. |
| `missing_code` | Instagram returned no code. | Retry; check the redirect URI in Meta. |
| `exchange_failed` | Instagram rejected the code or the long-lived exchange. | `IG_APP_ID` / `IG_APP_SECRET` are the **Instagram** ones (META_SETUP Part 4) and `IG_REDIRECT_URI` matches Meta exactly. |
| `profile_failed` | The token worked but the profile could not be read. | Account added to the app; `instagram_business_basic` granted. |
| `not_professional` | Personal account. | Switch it to Creator (META_SETUP Part 1). |
| `save_failed` | Database write failed. | Both migrations applied; `SUPABASE_SECRET_KEY` set on the server. |
| `not_configured` | `IG_*` variables missing on the server. | Vercel environment variables, then redeploy; `npm run check:env`. |
