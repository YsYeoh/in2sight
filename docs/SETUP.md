# Setup guide — what you need to do (and in what order)

Everything here uses free plans: **Vercel Hobby**, **Supabase Free**, **Meta for Developers**. Total time: about an hour.

| Step | You do | Guide | Needs from earlier steps |
|---|---|---|---|
| 1 | Deploy the repo to Vercel → get your app URL | below | — |
| 2 | Create the Supabase project, owner login, keys | [SETUP_SUPABASE.md](SETUP_SUPABASE.md) | the Vercel URL (for the auth redirect list) |
| 3 | Convert your Instagram accounts, create the Meta app, add testers | [META_SETUP.md](META_SETUP.md) | the Vercel URL (OAuth redirect) |
| 4 | Fill `.env.local`, run `npm run check:env` | below | steps 1–3 |
| 5 | Tell me it's done — login + 2FA and the Accounts page are built, so we then run `RUNBOOK_AUTH.md` then `RUNBOOK_META.md` | — | step 4 |

Why Vercel first: Meta and Supabase both want to know your app's public URL, and Meta compares the OAuth redirect address character for character. The current app already builds, so you can deploy it today.

---

## Secrets: how to hand them to me safely

- **Do not paste secret keys into this chat.** Chat logs are not a safe place for them.
- Put them in a file named **`.env.local`** in the project root (`c:\Users\yeohy\Documents\playground\in2sight\.env.local`). It is git-ignored, so it can never be committed by accident. I read it only to run and test the app locally, and I never print or commit its values.
- Put the same names and values in **Vercel → Project → Settings → Environment Variables** for the deployed app (I can't do that for you).
- If a secret ever leaks (pasted somewhere, committed), **rotate it**: Supabase → API Keys → create a new secret key and delete the old one; Meta → regenerate the app secret; replace the value in `.env.local` and Vercel.

## Step 1 — Vercel

1. Go to <https://vercel.com> and sign up with **GitHub** (the account that owns `YsYeoh/in2sight`).
2. **Add New… → Project → Import Git Repository** → pick `in2sight`. (If the repo isn't listed, click *Adjust GitHub App Permissions* and allow access to that repository.)
3. Framework should auto-detect as **Next.js**. Leave every setting at its default and click **Deploy**. No environment variables are needed for this first deploy.
4. When it finishes you get a URL like `https://in2sight-xxxx.vercel.app`. Open it: you should land on the style guide page.
5. **Make the URL stable:** *Project → Settings → Domains* shows the production domain. If you want a cleaner one, rename the project (*Settings → General → Project Name*) to `in2sight` — the domain becomes `in2sight.vercel.app` if that name is free. Pick it **before** step 3, because the Meta redirect address is built from it.
6. Write the final production URL down. In the rest of the guides it is called `<your-app-url>` (no trailing slash).

Every push to `main` redeploys automatically. After you add or change environment variables in Vercel, trigger a redeploy (*Deployments → ⋯ → Redeploy*).

## Step 4 — Fill `.env.local` and check it

```bash
cd c:/Users/yeohy/Documents/playground/in2sight
cp .env.example .env.local        # then open .env.local and fill in the values
npm run check:env                 # prints [ok] / [!!] per variable, never the values
```

You can check one part at a time while you work through the guides:

```bash
npm run check:env -- --only=app,supabase,security     # after the Supabase guide
npm run check:env -- --only=meta                      # after the Meta guide
```

Generate the two random secrets like this (works in any terminal with Node):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it once for `CRON_SECRET` (and again later for `REPORT_SIGNING_SECRET`).

### What each variable is for

| Variable | From | Used by |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | your Vercel URL (`http://localhost:3000` for local runs) | OAuth redirect, PWA, report links |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | browser + server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys (`sb_publishable_…`) | browser (login, reading your data under row-level security) |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys (`sb_secret_…`) | server only (sync jobs, token storage) |
| `SUPABASE_PROJECT_REF` | the 20 characters before `.supabase.co` | tooling |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | optional, for the Supabase CLI | migrations via CLI (not needed if I apply them with the connected Supabase tool) |
| `CRON_SECRET` | you generate it | the scheduler (cron-job.org, see docs/RUNBOOK_SYNC.md) proves itself to `/api/cron/tick` |
| `IG_APP_ID`, `IG_APP_SECRET` | Meta → Instagram → API setup with Instagram business login | connecting Instagram accounts |
| `IG_API_VERSION` | leave `v25.0` | Instagram API calls |
| `IG_REDIRECT_URI` | `<your-app-url>/api/instagram/callback` | where Instagram sends you back after login |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Plan 8 (optional: without them alerts stay in-app) | push notifications — docs/RUNBOOK_ALERTS.md §1 |
| `REPORT_SIGNING_SECRET` | later (Plan 8) | PDF report links |

## Step 5 — Tell me it's done

Reply with something like: *"Vercel URL is https://…; Supabase project `<ref>` is ready; Meta app is created, accounts added; `npm run check:env` is all green."* (The URL and project ref are not secret. Do not include keys.)

Then I will:
1. Confirm I can see the Supabase project with the connected Supabase tool and apply the database migrations (login with 2FA, accounts).
2. Walk you through `RUNBOOK_AUTH.md` and `RUNBOOK_META.md`: verify login, then connect each Instagram account on the Accounts page.

## Limits to keep in mind (free plans)

- **Supabase Free pauses a project after 7 days without activity.** Once the daily sync runs (Plan 5) the project stays awake. Until then, if it pauses, press *Restore project* in the dashboard.
- **Supabase Free database size is 500 MB.** Four accounts of daily snapshots use a few MB per year, so this is not a concern.
- **Vercel Hobby** is for personal, non-commercial use, which fits this project. We do not use Vercel Cron (Supabase schedules the jobs).
