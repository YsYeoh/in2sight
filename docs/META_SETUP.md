# Meta (Instagram) setup — how to let in2sight read your accounts

You will: convert your Instagram accounts to **Creator**, create a free **Meta app**, add your accounts to it, and give me the app's ID and secret via `.env.local`. About 30–45 minutes. Cost: free. **No Meta App Review and no business verification are needed**, because the app only serves accounts you own and add to it yourself (Meta calls this *Standard Access*).

> Meta renames menus often. This guide gives the labels from Meta's current documentation (October 2026). If your screen differs, take a screenshot (hide any secrets) and show me — I'll adapt.

Do the [Vercel step](SETUP.md#step-1--vercel) first: you need `<your-app-url>` (for example `https://in2sight.vercel.app`, no trailing slash).

---

## How the connection works (so the steps make sense)

1. Your Meta app has an **Instagram app ID** and **app secret**. They live in `.env.local`.
2. In in2sight you click **Add account**. The app sends you to Instagram's own login page (`instagram.com/oauth/authorize`). **You** log in there and approve two permissions: `instagram_business_basic` (profile, posts) and `instagram_business_manage_insights` (the numbers). in2sight never sees your Instagram password.
3. Instagram sends you back to `<your-app-url>/api/instagram/callback` with a one-time code. The server swaps it for a **60-day token**, stores it (server-only), and refreshes it automatically before it expires.
4. From then on the scheduled jobs use that token to pull insights. You never repeat this unless an account is revoked.

I can't log in to Instagram for you and I never see your password — **you click through the login for each account** on the Accounts page. This guide prepares everything so that works the first time.

---

## Part 1 — Make each Instagram account a Creator account

Personal accounts have no insights API (Meta shut down the old personal-account API in December 2024). Switching is free, instant and reversible; your posts and followers are untouched.

On your phone, for **each** account (3–4):

1. Open Instagram → your profile → **☰ menu → Settings and privacy → Account type and tools → Switch to professional account**.
2. Choose **Creator** → pick the category that fits → *Done*.
3. If it asks you to connect a Facebook Page or add contact details, **skip** — not needed.
4. Check the account can be reached by the API: **if an account is private, switch it to public** while we test. (Sources disagree on whether private accounts work; `docs/RUNBOOK_META.md` step 3 tests it; if a private account is refused, keep it public.)

Some metrics (audience demographics, followers online) only exist for accounts with **100+ followers** — smaller accounts still work for everything else.

## Part 2 — Meta developer account

1. Go to <https://developers.facebook.com> → **Get Started**.
2. Log in with your **Facebook** account (create a free one if you don't have it — the developer site needs it).
3. Verify your email/phone, accept the terms, and pick *Developer* when asked what describes you.

## Part 3 — Create the app

1. <https://developers.facebook.com/apps> → **Create app**.
2. **App name:** `in2sight` · **Contact email:** yours.
3. **Use case:** choose **Manage messaging and content on Instagram** (this is the use case that includes the *Instagram API with Instagram Login*). If you're offered an app *type* instead, choose **Business**: Meta's guide says the app must be a Business-type app.
4. Business portfolio: choose *none / skip* if you can.
5. **Create app** (Meta may ask for your Facebook password again).

Leave the app in **Development mode** — never press *Publish* / switch to *Live*. Development mode is exactly what we want.

## Part 4 — Find the Instagram app ID and secret

1. In the app dashboard: **Use cases → Manage messaging and content on Instagram → Customize**, or in the older layout the left menu **Instagram → API setup with Instagram business login**.
2. On that page you'll see **Instagram app ID** and **Instagram app secret** (click *Show*; Meta may ask for your password).
   - ⚠️ These are **different** from *App settings → Basic → App ID / App secret*. in2sight needs the **Instagram** ones.
3. Put them in `.env.local` (not in chat):

```
IG_APP_ID=<the numeric Instagram app ID>
IG_APP_SECRET=<the 32-character Instagram app secret>
IG_API_VERSION=v25.0
```

## Part 5 — Permissions

On the same use-case / API-setup page, under **Permissions and features**, add:

- ✅ `instagram_business_basic`
- ✅ `instagram_business_manage_insights`

Leave `instagram_business_manage_messages`, `…manage_comments` and `…content_publish` **off** — in2sight only reads, and asking for less is safer.

## Part 6 — The redirect address (must match exactly)

1. On the API-setup page open **Business login settings**.
2. Under **OAuth redirect URIs** add exactly:

   ```
   <your-app-url>/api/instagram/callback
   ```
   e.g. `https://in2sight.vercel.app/api/instagram/callback`
3. **Save, then re-read the saved list.** Meta compares the address character for character and its own docs warn the dashboard "might have added a trailing slash". If a `/` was appended at the end, remove it and save again.
4. If the form also insists on a **Deauthorize callback URL** and a **Data deletion request URL**, enter:
   - `<your-app-url>/api/instagram/deauthorize`
   - `<your-app-url>/api/instagram/delete`

   (Both endpoints exist. They verify Meta's signed request and only flag the account as *Needs reconnect*; nothing is deleted automatically. To erase an account's data, archive it and use *Delete permanently* on the Accounts page.)
5. Put the same address in `.env.local`:

```
NEXT_PUBLIC_APP_URL=<your-app-url>
IG_REDIRECT_URI=<your-app-url>/api/instagram/callback
```

Use HTTPS. Your Vercel URL is HTTPS; Meta's docs don't confirm that `http://localhost` is accepted, so we do the real connection on the deployed app, not on localhost.

## Part 7 — Add your Instagram accounts to the app

Development-mode apps only work for accounts you add. Do this for **every** account.

**Option A (try first):** on the *API setup* page there is a **Generate access tokens** section listing accounts, with an **Add account** button. Click it and log in to the Instagram account. (Use a separate browser profile or a private window per account — Instagram logs in as whichever account that browser is already signed in to.)

**Option B (if Option A isn't offered or the account doesn't appear):**
1. In the Meta app: **App roles → Roles → Add People** → role **Instagram Tester** → enter the account's Instagram username → *Add*.
2. Accept the invitation **as that Instagram account**:
   - on the web, signed in as that account: <https://www.instagram.com/accounts/manage_access/> → **Tester Invites** tab → *Accept*; or
   - in the Instagram app: **Settings → Website permissions → Apps and websites → Tester invites** *(label may differ)* → *Accept*.

The account should now show in the app's list of accounts/testers. (Meta's docs say Standard Access applies to accounts "you own or manage and have added to your app in the App Dashboard"; many 2026 guides still describe the tester step, so use whichever of A/B your dashboard shows.)

## Part 8 — Sanity check one account (2 minutes)

On the API-setup page click **Generate token** next to one account, log in, and copy the token. In a terminal (use the real token; **do not paste it into chat**):

```bash
curl "https://graph.instagram.com/v25.0/me?fields=user_id,username,account_type&access_token=PASTE_TOKEN_HERE"
```

You should get JSON with the username and an `account_type` of `Media_Creator` (Creator) or `Business` (Meta's docs spell the two values that way; capitalisation may vary). Then:

```bash
curl "https://graph.instagram.com/v25.0/me/insights?metric=reach&period=day&access_token=PASTE_TOKEN_HERE"
```

You should get `data` with numbers. Whatever it returns, tell me **only the message text** (no token): success, or the error. Tokens from this screen last 60 days and can be revoked by removing the app in the Instagram account's settings.

## Part 9 — Finish

1. Fill the Vercel environment variables (same names as `.env.local`), redeploy.
2. `npm run check:env -- --only=meta` → all `[ok]`.
3. Tell me: *"Meta app is ready, N accounts added as testers/accounts."*

Then follow `RUNBOOK_META.md`: on the **Accounts** page click **Add account** and log in to each account once.

---

## What the API can and can't give us (so expectations are right)

- **Insights history is limited.** Meta's docs say user metrics are stored for up to **90 days** (some individual metrics reach back less). Our database is the real history: it keeps a daily snapshot from the day you connect — **connect all accounts as early as possible**.
- **Stories** insights exist only while the Story is live (24 hours). in2sight captures them every 3 hours; Stories posted before you connect can't be recovered.
- Some **audience metrics need 100+ followers**; with fewer, Meta returns an empty result and the app says why.
- Metric names change over time (for example `impressions` became `views`); I verify them against Meta's current docs when I build the sync.

## Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| "Invalid redirect_uri" on the Instagram login page | The address differs by even one character (trailing slash, `http` vs `https`, wrong domain). Compare the saved list in Part 6 with `IG_REDIRECT_URI`. |
| "Invalid scope" / "permission not granted" | `instagram_business_manage_insights` isn't added in Part 5, or you used the old scope names (`business_basic` …, deprecated January 2025). |
| Account not offered / "not a professional account" | Part 1 not done for that account, or it isn't added to the app (Part 7). |
| Tester invite not visible | Log in to Instagram on the web as *that* account and open <https://www.instagram.com/accounts/manage_access/>. |
| `Application does not have permission` / `Unsupported get request` | Wrong ID type (Facebook vs Instagram app ID) or the account isn't a tester yet. |
| Token worked yesterday, fails today | Revoked in Instagram settings, password changed, or 60 days passed without refresh. in2sight shows *Needs reconnect*; click **Reconnect**. |
| `npm run check:env` says `IG_REDIRECT_URI must equal NEXT_PUBLIC_APP_URL + /api/instagram/callback` | Typo or trailing slash. Fix both variables to match Part 6. |

## Sources (Meta, checked October 2026)
- [Create an App](https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app/) · [Get started — Instagram API with Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)
- [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) · [Refresh Access Token](https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token)
- [Insights guide](https://developers.facebook.com/documentation/instagram-platform/insights) · [Overview](https://developers.facebook.com/docs/instagram-platform/overview/)
