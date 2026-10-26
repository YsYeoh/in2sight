# Supabase setup — what you do

Time: ~15 minutes. Cost: free. Do [Vercel first](SETUP.md#step-1--vercel) so you have your app URL.

Dashboard menus move around between Supabase releases. Where I couldn't confirm a label in the official docs it is marked *(label may differ)* — if you can't find something, send me a screenshot of the sidebar and I'll point you to it.

## 1. Create the project

1. Go to <https://supabase.com/dashboard> and sign in (GitHub is fine).
2. If asked, create an **organization** (name: anything, plan: **Free**).
3. **New project**:
   - **Name:** `in2sight`
   - **Database password:** click *Generate a password*, then **save it in your password manager** (you can't view it again; you can reset it if lost).
   - **Region:** the closest to you — *Southeast Asia (Singapore)*.
   - **Plan:** Free.
   - If the form offers **"Enable automatic RLS"**, turn it **on** (row-level security on every new table is exactly what we want).
4. Wait about a minute for it to finish provisioning.

## 2. Copy the project values (not secret)

- **Project URL:** *Project Settings → Data API (or API)* → looks like `https://abcdefghijklmnopqrst.supabase.co`.
- **Project reference:** the 20 characters before `.supabase.co`.

Put them in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
```

## 3. Copy the API keys (secret!)

*Project Settings → API Keys.* Supabase now issues two kinds of key (the old `anon` / `service_role` keys are being retired by the end of 2026, and still work meanwhile):

| In `.env.local` | In the dashboard | Looks like | Where it may be used |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Publishable key** | `sb_publishable_…` | browser — safe to expose |
| `SUPABASE_SECRET_KEY` | **Secret keys** → create one named `in2sight-server` if none exists | `sb_secret_…` | **server only** — it bypasses row-level security. Never in the browser, never committed, never pasted in chat |

If your dashboard only shows the legacy tab, use `anon` for the publishable variable and `service_role` for the secret one (both start with `eyJ`) — the check script accepts either form.

## 4. Authentication settings

*Authentication* in the sidebar.

1. **Create your owner login:** *Users → Add user → Create new user* → your email + a strong password → tick **Auto Confirm User** → create. This is the only account that will ever exist.
2. **Turn off public sign-ups:** *Sign In / Providers* *(label may differ)* → *User Signups* → switch **"Allow new users to sign up"** off. (The app also restricts login to your user and protects every table with row-level security, so even a forgotten switch exposes nothing — but turn it off anyway.)
3. **Two-factor (TOTP):** Supabase enables the TOTP multi-factor API on every project by default (official docs: *Auth → Multi-Factor Authentication*). You don't need to configure anything now; you will scan the QR code inside the app (Settings → Security). If your dashboard has an MFA setting, make sure TOTP is not set to *Verification Disabled*.
4. **URL configuration:** *Authentication → URL Configuration* *(label may differ)*:
   - **Site URL:** `<your-app-url>` (your Vercel URL, no trailing slash)
   - **Redirect URLs:** add `http://localhost:3000/**` and `<your-app-url>/**`
5. **Password reset email (Plan 16b):** custom SMTP, the Reset Password template, password minimum 12 and the Site URL https://in2sight.yongsen.space: see docs/RUNBOOK_SECURITY.md §0.

## 5. Database extensions

*Database → Extensions* → search and **enable** `pg_cron` (scheduler) and `pg_net` (lets the scheduler call our API). This step is optional: they are only needed for the fallback scheduler (docs/RUNBOOK_SYNC.md §6); the recommended scheduler is cron-job.org.

## 6. Generate `CRON_SECRET`

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output as `CRON_SECRET=` in `.env.local`. (It is a password our scheduler sends to our cron endpoints.)

## 7. Add the same variables to Vercel

*Vercel → Project → Settings → Environment Variables* → add every variable you filled in (`NEXT_PUBLIC_APP_URL`, the three Supabase ones, `CRON_SECRET`; `IG_*` after the Meta guide). Apply to **Production, Preview and Development**, then *Redeploy*.

## 8. Check it

```bash
npm run check:env -- --only=app,supabase,security
```

All `[ok]`? Then tell me *"Supabase is ready, project ref is `…`"* (the ref is not secret; **do not paste keys**).

## Database migrations

The schema lives in `supabase/migrations/` (plain SQL files). Apply it one of two ways:

- **Claude applies it** through the connected Supabase tool. The project must be in the same Supabase organization the connector can see.
- **You apply it** with `npx supabase db push`, which needs `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` in your environment.

After applying, follow `RUNBOOK_AUTH.md` to verify login and 2FA.

## What I do next

With the connected Supabase tool I can list your projects to confirm I can reach it, then apply the schema (accounts, tags, daily metrics, profiles, notifications…) with row-level security and the login + 2FA code. The database password and access token in `.env.example` are only needed if you'd rather run migrations yourself with the Supabase CLI.

## If a key leaks

*Project Settings → API Keys* → create a new secret key, update `.env.local` and Vercel, then delete the old key.

## Sources
- [Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [Migrating to publishable and secret keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Multi-Factor Authentication](https://supabase.com/docs/guides/auth/auth-mfa)
