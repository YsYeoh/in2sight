# Meta setup notes (owner checklist)

Meta's UI changes often; treat these as a guide, not exact click paths.

1. **Convert accounts:** Instagram app → Settings → Account type and tools → Switch to professional account → choose **Creator** (or Business). Free, reversible.
2. **Developer account:** https://developers.facebook.com → Get started (log in with Facebook, verify phone).
3. **Create app:** My Apps → Create app → use case "Other"/Business type → name it `in2sight`. Keep it in **Development mode**.
4. **Add product:** Instagram → *API setup with Instagram login*. Note the **Instagram app ID** and **Instagram app secret** (these are different from the main Meta app ID/secret).
5. **Redirect URI:** add `https://<your-vercel-domain>/api/instagram/callback` under Business login settings.
6. **Permissions:** `instagram_business_basic`, `instagram_business_manage_insights`.
7. **Testers:** App roles → Roles → add each Instagram account as **Instagram Tester**. Then, logged into each Instagram account: Settings → Apps and websites → Tester invites → Accept.
8. **Env vars (Vercel + local `.env.local`, never commit):**
   `IG_APP_ID`, `IG_APP_SECRET`, `IG_REDIRECT_URI`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Connecting several accounts: the OAuth screen uses whichever Instagram account is logged in in the browser. Use a separate browser profile or log out between accounts.
