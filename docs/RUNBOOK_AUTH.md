# Auth live-verification runbook

Run this once, after the Supabase project exists and `.env.local` is filled (see `SETUP.md`, `SETUP_SUPABASE.md`). The code and tests for auth are done; these steps prove it against the real project. Who: owner or Claude.

## Before the first login (read this)

1. **Disable sign-ups first.** Supabase Auth → *Sign In / Providers* → switch **"Allow new users to sign up"** off. Reason: `claim_ownership()` (called at every sign-in) makes the **first successful login the owner**. If sign-ups are open, a stranger who signs in before you becomes the owner. Create your owner user in the dashboard (*Authentication → Users → Add user*, Auto Confirm), and make sure yours is the first account that signs in.
2. **Every new data page must call `requireOwner()` itself** (`lib/auth/require-owner.ts`) at the top of the server component, route handler or server action. The proxy is only the first gate; `requireOwner()` is the second (session, AAL2 once 2FA is on, and `is_owner()`). Do not rely on the proxy alone.

## Steps

| # | Do | Expected |
|---|---|---|
| 1 | `npm run check:env` | Every required variable reports `[ok]`; no values are printed. |
| 2 | Apply `supabase/migrations/20261014000001_owner_and_profiles.sql`: with the connected Supabase tool (`apply_migration`, with the project ref) or `npx supabase db push` (needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD`). | Migration succeeds; tables `owners` and `profiles` exist. |
| 3 | Run the security advisor (`get_advisors`, type `security`). | No "RLS disabled" warning for `owners` or `profiles`. |
| 4 | `npm run dev`, open <http://localhost:3000/>. Sign in with the owner user from `SETUP_SUPABASE.md`. | `/` redirects to `/login`; after sign-in you land on `/overview`. |
| 5 | `/settings` → **Account** tab → *Enable two-factor*, scan the QR code with an authenticator app, enter the 6-digit code. Sign out, sign in again. | After the password you are sent to `/login/verify`; the correct code lands on `/overview`. A wrong code shows an error and stays on `/login/verify`. |
| 6 | In the dashboard create a second throw-away user (Auto Confirm) and sign in with it. | Sign-in fails with "This account is not allowed to use in2sight." (`auth.errors.not_owner`) and you are signed out. Delete the throw-away user afterwards. |
| 7 | In `/settings` change a preference (theme, date format). Sign out; sign in from a private window. | The preference is restored from your profile. |
| 8 | Without a session: `curl -I http://localhost:3000/overview` and `curl -I http://localhost:3000/settings`. | Both answer a redirect (307) with `location: /login`. |

If step 1 fails, the app shows `/setup` listing the variable names that need setting (never their values).

## Recovery

Lost authenticator: remove the factor in the Supabase dashboard (*Authentication → Users → your user → factors*), then sign in with the password only and re-enable 2FA in Settings → Account.
