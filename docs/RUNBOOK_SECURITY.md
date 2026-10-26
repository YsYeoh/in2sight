# Security live-verification runbook (Plan 16b: change password, forgot / reset, sign out other devices)

Code done on local `main`, NOT pushed; **nothing is verified live**; there is NO migration in Plan 16b. Who: the owner (a real inbox, the authenticator app and a second device are needed; an assistant cannot do this alone). Never paste a password, a reset link or a token hash into a chat or a log. Report only yes / no per step. Plan: `docs/superpowers/plans/2026-10-30-16b-security.md`.

Forgot / reset CANNOT work until section 0 is done: the code cannot do those settings for you (they are in the Supabase dashboard).

## 0. Owner prerequisites (Supabase dashboard; labels may differ)

| # | Where | Set | Why |
|---|---|---|---|
| 0.1 | Authentication → Emails → SMTP Settings | Custom SMTP with the provider you chose; sender e.g. `no-reply@yongsen.space` (add the provider's SPF / DKIM records to `yongsen.space`) | the built-in mailer sends 2 emails per hour and lands in spam |
| 0.2 | Authentication → Rate Limits | Emails per hour: **10** (leave the others at their defaults) | caps email bombing of your inbox |
| 0.3 | Authentication → URL Configuration | Site URL **`https://in2sight.yongsen.space`** (no trailing slash); Redirect URLs `https://in2sight.yongsen.space/**`, `http://localhost:3000/**` | the reset link is built from the Site URL |
| 0.4 | Authentication → Emails → Templates → **Reset Password** | the subject and body below | the link must go to `/auth/confirm` with the token hash |
| 0.5 | Authentication → Providers → Email (password settings) | Minimum password length **12**; "Secure password change" **off**; "Require current password when updating" **off** if shown; Email OTP expiration **3600** | the app checks the current password itself; the UI says the link expires after 1 hour |
| 0.6 | Authentication → Sign In / Providers | "Allow new users to sign up" **off** (re-check) | you stay the only account that can ever get a reset email |
| 0.7 (optional) | Project Settings → JWT (access token expiry) | default 3600 s; lower only if you want other devices cut off sooner (then tell the assistant: the "up to 1 hour" text must change) | a signed-out device keeps working until its token expires |

**Reset Password template** (one template for both languages; Supabase has no per-language templates):

Subject: `Reset your in2sight password / 重置你的 in2sight 密码`

Body (HTML):

```html
<p>Someone asked to reset the password of your in2sight account. If it was you, open this link (it works once and expires after 1 hour):</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset my password</a></p>
<p>If it was not you, ignore this email: nothing changes.</p>
<hr>
<p>有人申请重置你的 in2sight 账号密码。如果是你本人，请打开下面的链接（只能使用一次，1 小时后失效）：</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">重置我的密码</a></p>
<p>如果不是你本人操作，请忽略此邮件，一切不会改变。</p>
```

Record here which settings were on before you changed them (0.5): ______

## Open questions that only a live run can answer (the code defaults are safe if a check fails)

| Id | Question | Where checked | If it fails |
|---|---|---|---|
| L1 | The current-password check signs in on a separate memory-only client and revokes that check session at once: does it leave the owner's own session alone and leave no extra session behind? | §3 steps 4 to 6 | change password misbehaves: stop and report; alternative is Supabase's "require current password" |
| L2 | What `amr` method name does a recovery session carry (`recovery`, `otp` or `magiclink` are accepted) and does it survive the TOTP step? | §2 step 5 and 6 | `/login/reset` says "This reset has expired" and nothing changes: report; use the old way (assistant + Auth admin API) meanwhile |
| L4 | Do "Secure password change" / "Require current password" exist in your dashboard and what are they set to? | §0.5 (record above) | with "Secure password change" on, `updateUser` can answer `reauthentication_needed` (shown as the generic error) |
| L7 | JWT expiry: after "Sign out other devices", a password change or a reset, another open device keeps working up to 1 hour (default) | §2 step 8, §3 step 5, §4 step 1 | lower the expiry (§0.7) and tell the assistant to change the UI text |
| L8 | Link expiry (1 hour) and single use | §2 steps 10 and 11 | report the real behaviour |
| L9 | The link works on another device than the one that asked (PKCE cookie not needed for a token hash) | §2 step 1 | report |

## 1. Forgot password: the generic answer (no account is revealed)

1. Signed out, open `/login`: a "Forgot password?" link sits under the form → `/login/forgot`.
2. Enter a made-up address (`nobody-1234@example.com`) and send: "If that email belongs to the owner's account, a reset link is on its way…". Time it (browser DevTools → Network, the POST to `/login/forgot`): about 2 s.
3. Private window (fresh cookies), enter YOUR email and send: the SAME text, also about 2 s (if it is clearly slower, the SMTP send is longer than the 2 s floor: report the two times).
4. Send again within a minute in the same window: "A link was requested a moment ago…" (cooldown); no second email arrives.
5. `not-an-email` → "Enter a valid email address."

## 2. Reset end to end on a real inbox

1. The email from step 1.3 arrives (check spam) with the bilingual text. Do NOT click it yet on the same device: open it on a **second device** (phone) to prove it works across devices (L9).
2. The link opens `/auth/confirm` with a "Continue" button (nothing has happened yet: a GET never uses the link).
3. Continue → you land on `/login/verify` (2FA is still required: the recovery session is aal1).
4. **The aal1 recovery session sees nothing:** before entering the code, type `/overview`, `/settings/security`, `/login/reset` and `/api/export/xlsx` in the address bar: each goes back to `/login/verify`.
5. Enter the authenticator code → `/login/reset` "Choose a new password".
6. If you see "This reset has expired" instead: L2 (the recovery claim) failed live: stop and report; nothing was changed. Use the old way (the assistant + Auth admin API) meanwhile.
7. Type a weak password (`short`): the meter says "Too weak" and saving answers the rule; type two different passwords: "don't match".
8. Save a good password → `/login` with "Password changed. Sign in with your new password." Every device is signed out (the first device too, within the JWT expiry: up to 1 hour for a device that stays open; L7).
9. Sign in with the NEW password + code: works. The OLD password: "Wrong email or password."
10. Open the same email link again → Continue → "This link has expired or was already used." (single use, L8).
11. Request a new link, open it, Continue, enter the code, then wait more than 15 minutes on `/login/reset` before saving: saving answers "This reset has expired. Request a new link." (the 15-minute window).

## 3. Change password in Settings → Security

1. Sign in on two devices (A and B). On A open Settings → Security: the email, Two-factor (unchanged), Password, Signed-in devices.
2. Wrong current password → "The current password is wrong." on that field; the typed values stay.
3. Five wrong attempts in a row → "Too many attempts…" (the cookie limit: a private window resets it; that is expected, Supabase's own limit is the real one).
4. Correct current password + a good new one → "Password changed. Your other devices were signed out." A stays signed in (L1).
5. On B: within at most 1 hour (sooner when B refreshes its token) B lands on `/login`. Sign in on B with the new password.
6. Owner only, Supabase SQL editor: `select count(*) from auth.sessions;` right after step 4 equals the number of devices still signed in (here 1: the current-password check left no session behind, L1).

## 4. Sign out other devices

1. Signed in on A and B; on A press "Sign out other devices" → "Your other devices were signed out." A stays signed in; B is signed out within the JWT expiry. (Supabase has no call that lists sessions, so there is one button and no device list.)
2. The sidebar "Sign out" signs out EVERY device including this one (it always did: Supabase's default scope is global).

## 5. Inside a tab frame

Settings → Security opened as a shell tab: the form works inside the frame. `/login/forgot`, `/login/reset` and `/auth/confirm` always take over the whole window (they are not tab pages).

## 6. Privacy and logs

- Vercel → Logs: no password anywhere; the `/auth/confirm?token_hash=…` GET line contains the one-time token hash (single use, expires after 1 hour; worthless after step 2.5). Nothing else of the flow appears in the logs.
- No error message ever names a Supabase internal ("Invalid login credentials", "User not found", …).
- The code side is guarded by `tests/auth-security-guard.test.ts` (no logging, no redirect parameter, no service-role client, literal redirect paths, `requireOwner()` first in the owner actions).

Record the outcomes here and tick `docs/TODO.md` §6p only after the owner has looked.
