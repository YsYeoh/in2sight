# Auth live-verification runbook

Run this once, after the Supabase project exists and `.env.local` is filled (see `SETUP.md`, `SETUP_SUPABASE.md`). The code and tests for auth are done; these steps prove it against the real project. Who: owner or Claude.

## Before the first login (read this)

1. **Disable sign-ups first.** Supabase Auth → *Sign In / Providers* → switch **"Allow new users to sign up"** off. Reason: `claim_ownership()` (called at every sign-in) makes the **first successful login the owner**. If sign-ups are open, a stranger who signs in before you becomes the owner. Create your owner user in the dashboard (*Authentication → Users → Add user*, Auto Confirm), and make sure yours is the first account that signs in.
2. **Every new data page must call `requireOwner()` itself** (`lib/auth/require-owner.ts`) at the top of the server component, route handler or server action. The proxy is only the first gate; `requireOwner()` is the second (session, AAL2 once 2FA is on, and `is_owner()`). Do not rely on the proxy alone.

## Steps

| # | Do | Expected |
|---|---|---|
| 1 | `npm run check:env -- --only=app,supabase,security` | Every variable in those groups reports `[ok]`; no values are printed. (The Meta group is not needed for auth.) |
| 2 | Apply `supabase/migrations/20261014000001_owner_and_profiles.sql`: with the connected Supabase tool (`apply_migration`, with the project ref) or `npx supabase db push` (needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`). | Migration succeeds; tables `owners` and `profiles` exist. |
| 3 | Run the security advisor (`get_advisors`, type `security`). | No "RLS disabled" warning for `owners` or `profiles`. |
| 4 | `npm run dev`, open <http://localhost:3000/>. Sign in with the owner user from `SETUP_SUPABASE.md`. | `/` redirects to `/login`; after sign-in you land on `/overview`. |
| 5 | `/settings` → **Account** tab → *Enable two-factor*, scan the QR code with an authenticator app, enter the 6-digit code. Sign out, sign in again. | After the password you are sent to `/login/verify`; the correct code lands on `/overview`. A wrong code shows an error and stays on `/login/verify`. |
| 6 | In the dashboard create a second throw-away user (Auto Confirm) and sign in with it. | Sign-in fails with "This account is not allowed to use in2sight." (`auth.errors.not_owner`) and you are signed out. Delete the throw-away user afterwards. |
| 7 | In `/settings` change a preference (theme, date format). Sign out; sign in from a private window. | The preference is restored from your profile. |
| 8 | Without a session: `curl -I http://localhost:3000/overview` and `curl -I http://localhost:3000/settings`. | Both answer a redirect (307) with `location: http://localhost:3000/login` (absolute). |

If the Supabase URL or publishable key is missing, the app shows `/setup` listing the variable names that need setting (never their values). A missing app URL, secret key or cron secret does not trigger `/setup`; step 1 reports it.

## How access is enforced

- Once a verified factor exists, the database itself requires an `aal2` session: `is_owner()` (which every RLS policy uses) is false for a password-only (`aal1`) token. Calling PostgREST directly with only the password gets nothing.
- A signed-in user who is not the owner is sent to `/auth/signout` (ends the session, redirects to `/login`). A failed owner check (database error) shows the error page instead of redirecting, to avoid a redirect loop. `/auth/signout` is allowed for any signed-in state, including a pending 2FA code.
- Deleting the owner's auth user cascades to `owners`, which re-opens first-login-wins: the next dashboard user who signs in becomes the owner. Keep sign-ups disabled and do not delete that user casually.

## Recovery

Lost authenticator: remove the factor in the Supabase dashboard (*Authentication → Users → your user → factors*), then sign in with the password only and re-enable 2FA in Settings → Security. Because RLS only demands `aal2` while a verified factor exists, removing the factor also restores `aal1` access to your data.

Forgot password (Plan 16b): the login page's "Forgot password?" sends a recovery email; with 2FA on, the link alone gives no data access (the app and RLS need your authenticator code); the app enforces "code before a new password" in its own pages, not in Supabase Auth (docs/RUNBOOK_SECURITY.md L10/L11), and without an enrolled factor the link alone is a full session: enrol 2FA first. Setup and live checks: docs/RUNBOOK_SECURITY.md. Lost authenticator AND forgot password: the dashboard route above, then reset.
