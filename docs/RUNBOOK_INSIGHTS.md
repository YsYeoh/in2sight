# Runbook: Insights feed + Today (Plan 17b) — live checks

Nothing here has been verified live. Do it with the owner, signed in with 2FA, on the deployed app. Report yes/no and counts only.

## 0. The migration — on the owner's go-ahead, BEFORE deploying
`supabase/migrations/20261101000001_insight_dismissals.sql` adds one table. Applied 2026-11-04 (the dry-run listed exactly this file, `migration list` showed 17 / 17, the anon probe gave 401 / 42501). The commands stay for reference; with Supabase CLI 3.x add `--remote` to each.
    node --env-file=.env.local scripts/sb.mjs migration list --remote        # expect only 20261101000001 pending
    node --env-file=.env.local scripts/db-probe.mjs table:insight_dismissals   # before: 404 PGRST205 (absent)
    node --env-file=.env.local scripts/sb.mjs db push --remote --dry-run     # expect exactly that file
    node --env-file=.env.local scripts/sb.mjs db push --remote --yes
    node --env-file=.env.local scripts/sb.mjs migration list --remote        # N local / N remote / 0 mismatched
    node --env-file=.env.local scripts/db-probe.mjs table:insight_dismissals   # after: 401 / 42501 (exists, anon denied)
Before `db push`, the dry-run must list exactly one pending file; if it lists an older migration too, stop and ask the owner.
Not checked from the CLI: that the signed-in owner can read and write the table (RLS passes `is_owner()`); the first dismiss in section 2 is that check.
Without it: no Dismiss buttons and the line "Dismissing findings needs a database update".

## 1. Findings make sense (L1)
1. Each of the owner's accounts → Overview tab → Findings card. For every finding: open "Show the evidence"; the linked page shows the same story (Post Lab for a breakout, Growth with the day picked for an unusual day, Posts filtered by format, Comments → Unanswered questions).
2. Check the numbers of one `best_slot` against the best-time heatmap ("your post performance") and one `format_winner` against the format table: same direction.
3. Note any finding the owner calls wrong or useless (rule + why). A rule nobody acts on in a month is deleted, not tuned.
4. No finding says "High"; every card says "Patterns, not proof."

## 2. Dismiss and snooze (L2)
1. Dismiss one finding → "Hidden." and it leaves the list; reload → still gone; open the account in a second shell tab → gone there too.
2. "Hide for 7 days" on another → gone after reload; Supabase SQL editor (read-only, owner runs it): `select finding_key, until from public.insight_dismissals order by created_at desc limit 5;` shows `until` ≈ now + 7 days and NULL for the dismissed one. Keys hold no usernames or captions.
3. If an account has a hashtag finding, dismiss it (non-ASCII hashtag if possible): it stays hidden after reload (the keyed read with `:` and non-ASCII works).

## 3. Today (Overview)
1. Today sits above the range bar; changing the range does not change Today.
2. "Latest day vs your normal": the date is the KPIs' last settled day; the reach matches the account's Growth tab for that day; an "Unusual" badge only on a clear outlier.
3. "Needs attention": a reconnect / failing account shows first; the unanswered count matches Comments → Unanswered questions with the last 7 days (L4).
4. "Working now" opens the right Post Lab; "Next" names a weekday and day part and a date in the coming week, or says there are not enough posts.

## 4. Speed (L3)
DevTools → Network, `/overview` document (warm, 3 reloads): note the times before deploying 17b and after. Budget: ≤ 1.2 s p75. Over budget: report the times (the extra work is a 64-day daily read, one count rpc per account and one keyed read).

## 5. Phone and themes
360 / 768 / 1280 px, light and dark of two themes: Today one column on a phone, no horizontal scroll, long handles wrap; the Findings buttons stay tappable.

## 6. Privacy
Vercel logs: no row content. Today and the findings never show a commenter name or comment text; only counts.

Record outcomes here; tick `docs/TODO.md` (Plan 17b section) only after the owner has looked.
