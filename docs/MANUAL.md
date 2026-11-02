# in2sight user manual: set it up, host it, use it

This manual takes you from nothing to your own running in2sight, then shows you around. Allow **about an hour** for the first setup. Everything below uses free plans.

> in2sight is a **personal tool, one owner per deployment**. You host your own copy and connect your own Instagram accounts. Nobody else can sign in to it, and your data never leaves your own Supabase project.

**Contents:** [1. What you need](#1-what-you-need) · [2. Get the code](#2-get-the-code) · [3. Supabase](#3-supabase-your-database-and-login) · [4. Meta app](#4-meta-app-and-your-instagram-accounts) · [5. Settings file](#5-the-settings-file-envlocal) · [6. Database tables](#6-create-the-database-tables) · [7. Host it on Vercel](#7-host-it-on-vercel) · [8. Start the sync](#8-start-the-sync-scheduler) · [9. First sign-in](#9-first-sign-in-and-connecting-accounts) · [10. Tour](#10-a-tour-of-the-app) · [11. Optional extras](#11-optional-extras) · [12. Other hosts](#12-hosting-somewhere-other-than-vercel) · [13. Updating](#13-updating-to-a-new-version) · [14. Your data](#14-your-data-backups-export-delete) · [15. Troubleshooting](#15-troubleshooting)

---

## 1. What you need

| You need | Why | Cost |
|---|---|---|
| A **GitHub** account | to hold your copy of the code and let Vercel deploy it | free |
| A **Vercel** account | hosts the web app | free (Hobby, personal use) |
| A **Supabase** account | database, login, file storage | free (500 MB database) |
| A **Meta for Developers** account (needs a Facebook login) | the free app that lets in2sight read Instagram | free |
| A scheduler account at **cron-job.org** | calls the sync every 30 minutes | free |
| An Instagram **Creator** or **Business** account | personal accounts have no insights API | free |
| **Node.js 20 or newer** and **Git** on your computer | to run the setup commands | free |

Good to know before you start:
- Instagram **Personal** accounts cannot be read. Switching to Creator is free, instant and reversible (Instagram app → Settings and privacy → Account type and tools → Switch to professional account → Creator).
- Some numbers (audience demographics, when your followers are online) only exist for accounts with **100 or more followers**.
- Instagram only lets you look back about **90 days** at account level, and Stories vanish after 24 hours. in2sight records as it goes, so **connect early**: its history begins the day you connect.

---

## 2. Get the code

1. On GitHub, **fork** this repository (or use it as a template) so you have your own copy.
2. Clone your copy and install:

```bash
git clone https://github.com/<you>/in2sight.git
cd in2sight
npm install
```

3. Copy the settings template (you will fill it in during the next steps):

```bash
cp .env.example .env.local
```

`.env.local` is git-ignored. **Never commit it and never paste its values into chats, issues or screenshots.**

---

## 3. Supabase: your database and login

Full click-by-click version: [SETUP_SUPABASE.md](SETUP_SUPABASE.md). The essentials:

1. At <https://supabase.com/dashboard> create an organization (Free) and a **New project**. Save the database password it generates in a password manager. Pick the region closest to you.
2. **Project Settings → API**: copy the **Project URL** and the **Project reference** (the 20 characters before `.supabase.co`) into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_PROJECT_REF`.
3. **Project Settings → API Keys**: copy the **Publishable key** (`sb_publishable_…`) into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and create a **Secret key** (`sb_secret_…`) for `SUPABASE_SECRET_KEY`. The secret key bypasses row-level security: it lives only on the server.
4. **Authentication → Users → Add user → Create new user**: your email and a strong password, with **Auto Confirm User** ticked. This is the only login that will ever exist.
5. **Turn off public sign-ups** (Authentication → Sign In / Providers → "Allow new users to sign up" off). **Do this before your first sign-in.** The first account to sign in becomes the owner, so open sign-ups would let a stranger claim your app.
6. **Authentication → URL Configuration**: Site URL = your final app URL (you get it in step 7; come back and set it then), and add `http://localhost:3000/**` to the redirect URLs.
7. Generate the scheduler password and put it in `.env.local` as `CRON_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Supabase Free pauses a project after 7 days with no activity. Once the scheduler runs (step 8) it never idles.

---

## 4. Meta app and your Instagram accounts

Full click-by-click version: [META_SETUP.md](META_SETUP.md). The essentials:

1. Make each Instagram account a **Creator** account (section 1).
2. Create a developer account at <https://developers.facebook.com>, then **Create app**. Use case: **Manage messaging and content on Instagram**.
3. **Leave the app in Development mode. Do not publish it.** Development mode needs no App Review and works for accounts you add yourself.
4. In the app, open **Use cases → Manage messaging and content on Instagram → Customize** and copy the **Instagram app ID** and **Instagram app secret** into `IG_APP_ID` and `IG_APP_SECRET`. These are *not* the Facebook app ID and secret from Basic settings; this mix-up is the most common first-run error.
5. Add the permissions `instagram_business_basic` and `instagram_business_manage_insights`. For comment features also add `instagram_business_manage_comments`.
6. Add the OAuth redirect `https://<your-app-url>/api/instagram/callback` (and `http://localhost:3000/api/instagram/callback` if you test locally). Meta compares it character for character.
7. **App roles → Roles → Add People → Instagram Tester**: add each Instagram username, then accept the invite from that account (instagram.com/accounts/manage_access → Tester Invites).

---

## 5. The settings file (`.env.local`)

| Variable | What it is | Secret? |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | your app's public URL, no trailing slash (`http://localhost:3000` locally) | no |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | no (browser-safe) |
| `SUPABASE_SECRET_KEY` | Supabase secret key | **yes, server only** |
| `SUPABASE_PROJECT_REF` | 20-character project reference | no |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | optional, only for running migrations with the CLI helper script | **yes** |
| `CRON_SECRET` | the password your scheduler sends to the sync endpoint | **yes** |
| `IG_APP_ID`, `IG_APP_SECRET` | the Instagram app ID and secret from step 4 | secret is **yes** |
| `IG_REDIRECT_URI` | `<your-app-url>/api/instagram/callback` | no |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional, only for push notifications ([section 11](#11-optional-extras)) | private key **yes** |

Then check the file. It prints OK or what is wrong, **never a value**:

```bash
npm run check:env
```

---

## 6. Create the database tables

The schema is a set of SQL files in [`supabase/migrations/`](../supabase/migrations/). Apply them in order with the Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

It asks for the database password from step 3.1. When it finishes, **Supabase dashboard → Advisors → Security** should show no "RLS disabled" warning: every table is protected by row-level security and only the owner can read anything.

You can also paste each file into the Supabase **SQL editor** in filename order. Never edit a migration that has already been applied; new changes always come as new files.

---

## 7. Host it on Vercel

1. <https://vercel.com> → sign up with GitHub → **Add New… → Project** → import your fork. Framework: **Next.js** (auto-detected). Deploy with the defaults.
2. **Settings → Environment Variables**: add **every variable** from `.env.local` (all environments), with `NEXT_PUBLIC_APP_URL` set to your Vercel URL.
3. **Deployments → ⋯ → Redeploy** so the variables take effect. Redeploy again after any later change to them.
4. Go back to Supabase (**step 3.6**) and set the **Site URL** to this URL. Go back to Meta (**step 4.6**) and set the OAuth redirect to `<this URL>/api/instagram/callback`.
5. Make sure the production domain is **not behind Vercel Deployment Protection** (the default only protects previews); the scheduler must reach it.

Every push to `main` of your fork redeploys automatically.

Check it: open your URL. You should land on the sign-in page.

---

## 8. Start the sync (scheduler)

in2sight does not use Vercel Cron. Any service that can call a URL every 30 minutes works; [cron-job.org](https://cron-job.org) is free and keeps a history.

1. **Cronjobs → Create cronjob**. URL: `https://<your-app-url>/api/cron/tick`. Schedule: every 30 minutes.
2. **Advanced**: method `GET`; add the header `Authorization` with the value `Bearer <your CRON_SECRET>` (the word Bearer, a space, then the secret); timeout 30 s.
3. **Test run**. Expected answer: `202` and `{"accepted":true}`. A `401` means the header or secret is wrong; a `503` means a variable is missing on Vercel.

The endpoint answers immediately and does the work for up to 60 seconds afterwards. If cron-job.org is not an option, a Supabase `pg_cron` fallback is documented in [RUNBOOK_SYNC.md §6](RUNBOOK_SYNC.md).

---

## 9. First sign-in and connecting accounts

1. Open your app URL and sign in with the owner email and password from step 3.4.
2. **Settings → Security → set up two-factor.** Scan the QR code with an authenticator app, enter the 6-digit code. From now on every sign-in asks for a code, and the database itself refuses anyone without it. **Do this first**: it also makes password-reset emails safe to enable later.
3. **Accounts → Add account.** You are sent to Instagram's own login page; you approve the permissions there. in2sight never sees your Instagram password. Repeat for each account.
4. Watch the progress panel. A new account is imported **newest first**, so the Overview fills within a few minutes; the older history (back about 90 days) and every post's metrics follow over the next sync rounds. Leave it running; each 30-minute tick continues where the last one stopped.

Instagram tokens last 60 days and are refreshed automatically. If one cannot be renewed, you are alerted and the account shows **Reconnect**.

---

## 10. A tour of the app

| Where | What you get |
|---|---|
| **Overview** | all accounts at a glance: followers, reach, views, engagement, posts, net follows, versus the previous period; sync and token status |
| **Account → Overview** | reach and views over time, followers curve, a format comparison, flags ("a post reached 2× your usual"), and the best time to post |
| **Account → Growth** | follower projection with its method and confidence, follows versus unfollows, loyal versus discovery reach, "why did this change?" |
| **Account → Posts / Stories** | filterable, sortable lists with cover images; click one for its page: scorecard against your own history, caption analysis, Story funnel |
| **Account → Content** | what works: leaderboards (best posts by reach, saves, shares, rates), formats and times, hashtags, posting cadence |
| **Account → Comments / Moderation** | unanswered questions, top fans, topics; optional reply, hide, delete and banned-word rules. Every write to Instagram is confirmed and logged. **Auto-hide is off by default** |
| **Account → Followers** | upload your Instagram data export to see who followed, unfollowed or does not follow back (parsed on your device) |
| **Tags** | label posts with content pillars and compare them |
| **Calendar** | what you posted when |
| **Explorer** | choose any metric and dimension, drill down, save the view, export it |
| **Settings** | appearance, language (English, 简体中文), date / time / number formats, alerts and push, accounts, security, **data and privacy** |

Tips:
- The **time range** bar sits in the URL: copy the link to share a view with yourself on another device.
- The app has **browser-style tabs** in the header. Open several pages side by side; the side navigation stays.
- An analysis that does not have enough data says so and shows why instead of a number. A missing value is never shown as zero.
- **Export** on an account makes an Excel or PDF report.
- On a phone, use your browser's **Install app** / **Add to Home Screen** to install it as an app.

---

## 11. Optional extras

**Push notifications.** Generate keys once with `npx web-push generate-vapid-keys`, put them in `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, set `VAPID_SUBJECT=mailto:you@example.com`, add all three to Vercel, redeploy, then **Settings → Notifications → Enable notifications** on each device. See [RUNBOOK_ALERTS.md](RUNBOOK_ALERTS.md).

**Password-reset email.** Needs your own SMTP service and a template in Supabase. Set up and test it only after two-factor is on: [RUNBOOK_SECURITY.md §0](RUNBOOK_SECURITY.md).

**Comment moderation.** Reconnect each account once so Instagram grants the comment permission, then follow [RUNBOOK_MODERATION.md](RUNBOOK_MODERATION.md). It writes to your real account, so test on a throwaway comment first.

---

## 12. Hosting somewhere other than Vercel

Vercel is the only tested path. In principle any host that can run a Next.js server works if it provides: HTTPS, Node 20+, the same environment variables, a request time limit of **at least 60 seconds** for `/api/cron/tick`, and a way to reach it from your scheduler. Docker or a VPS (`npm run build`, then `npm start` behind a reverse proxy) should work but is **not tested**. Please report what you find.

---

## 13. Updating to a new version

1. Pull the new code into your fork (`git pull` from the upstream remote).
2. Look for **new files** in `supabase/migrations/` (there are no release notes yet; `git log -- supabase/migrations` lists them).
3. **Apply new migrations first** (`npx supabase db push`), *then* let Vercel deploy. The app tolerates a missing newer migration by showing "needs a database update", but applying first avoids the message.
4. Run `npm run check` if you changed anything yourself.

---

## 14. Your data: backups, export, delete

- **Settings → Data and privacy** shows how much storage you use, lets you **export every table as JSON** (people's names and comments only if you tick the box), and lets you **delete all data** (asks for your password and a typed word; keeps your login).
- Export regularly. Instagram only returns about 90 days of account history, so *your* recorded history is the long-term copy.
- Instagram access: in the Instagram app, Settings → Website permissions → Apps and websites, you can remove in2sight at any time.

---

## 15. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `/setup` page lists variable names | those Supabase variables are missing on Vercel; add them and redeploy |
| Scheduler test returns `401` | header must be exactly `Authorization: Bearer <CRON_SECRET>` and the same secret must be in Vercel |
| Scheduler test returns `503` | `CRON_SECRET`, `SUPABASE_SECRET_KEY` or an `IG_*` variable is missing on Vercel |
| Scheduler `202` but no data | migrations not applied (section 6), or no account connected yet |
| "Application does not have permission" / "Unsupported get request" | you used the Facebook app ID instead of the **Instagram** app ID, or the account is not added as a tester yet |
| Instagram redirect error | the redirect URL in Meta differs from `IG_REDIRECT_URI` by even one character |
| "This account is not allowed to use in2sight." | you signed in with a user that is not the owner |
| Account shows "Reconnect" | token could not be renewed or access was revoked; press Reconnect |
| A chart is empty, or says "needs a database update" | Instagram does not provide some numbers for accounts under 100 followers, or a migration has not been applied |
| Lost your authenticator | Supabase dashboard → Authentication → Users → your user → remove the factor, sign in, set up two-factor again |

Deeper, step-by-step checks live in the `docs/RUNBOOK_*.md` files. For a bug, open an issue with the **steps and the error text, but never tokens, keys or follower / commenter data**.
