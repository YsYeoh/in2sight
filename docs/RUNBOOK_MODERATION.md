# Runbook — Comment moderation (Plan 15d)

Status: code complete on local `main`, NOT pushed, NOTHING verified live, and NOTHING has ever been sent to Instagram by this code.
The migration `20261029000002_comment_moderation.sql` is NOT applied to the live database. **Auto-hide is OFF by default and must
stay off until §1 (probes P1–P8) has passed on a throwaway comment.**

Reply, hide/unhide and delete from the app, banned-word and spam auto-hide, the moderation log with Undo. **WARNING: this feature
WRITES to the owner's real Instagram accounts** (replies are posted, comments are hidden or deleted, in public). Every check
below is done WITH the owner (2FA login, real Instagram accounts). Never paste comment texts, commenter names, tokens or
URLs with `access_token` into chat, tickets or this file: write yes/no, counts and error keys only.

## 0. The migration (apply BEFORE deploying the code that needs it; the owner says go)
File `supabase/migrations/20261029000002_comment_moderation.sql`. It needs 15c's `20261029000001_comment_insights.sql`
applied FIRST or in the same push (RUNBOOK_COMMENTS §0). Order: 15c migration, then this one, then deploy the code.
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect only the pending file(s): 20261029000001 (unless already applied) and 20261029000002; nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs table:moderation_log table:moderation_rules table:moderation_settings   # before: 404 PGRST205
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file(s), in that order
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # N local / N remote / 0 mismatched (14 / 14 when both 15c and 15d are applied)
node --env-file=.env.local scripts/db-probe.mjs table:moderation_log table:moderation_rules table:moderation_settings   # after: 401 / 42501 (exists, anon denied)
```
Until the migration is applied: the Moderation tab says "needs a database update", the Comments tab's row menu (Moderate ⋯) is
hidden, a server action answers `not_ready`, and the tick skips the auto-hide pass. The code works before and after.

## 1. Live probes on a THROWAWAY comment first (gate: before trusting anything below, and before auto-hide)
Prerequisites: §0 done, and the owner has pressed **Reconnect once on each account** (Accounts page) to grant the comments scope
(RUNBOOK_COMMENTS §1; without it the tab shows "Comments are off" and no menu).
Use the owner's own test post (or a new post you delete afterwards). From a SECOND Instagram account (or ask a friend),
write three comments: "probe one", "probe two www.example.com", "probe three". Wait for the hourly comments read (or
Sync now), then in in2sight → the account → Comments:
| # | Probe (Open question) | Do | Expect | Result |
|---|---|---|---|---|
| P1 | write permission | Hide "probe one" | "Comment hidden."; on Instagram (the app, logged in as the owner) the comment shows as hidden; the log shows Hidden · By you · Done | |
| P3 | hide twice | Instagram app: unhide it there; in2sight: Hide again | either "Already done" (our state) or Done; never an error page | |
| P1 | unhide | Log → Unhide | visible again on Instagram; the log row says "Undone …" | |
| P6/P7 | reply (2,200-character limit, form-encoded message) | Reply "thanks 🙏 @ownaccount #test" to "probe two"; then, once, a reply of exactly 2,200 characters (and check that 2,201 is refused by the dialog) | "Reply posted."; the reply appears on Instagram with the emoji, mention and hashtag; the long one is accepted | |
| P8 | undo a reply (deleting a reply) | Log → Delete reply | the reply is gone on Instagram | |
| P1 | delete | Delete "probe three" (type DELETE) | gone on Instagram; the row disappears from Comments; the log shows Deleted (no Undo) | |
| P5 | hidden flag on reads | after hiding "probe one" again, Sync now; Supabase SQL: `select hidden from comments where id = '<id>'` | true (our value survives the re-read); note whether the comment still came back in the read (count only) | |
| P4 | replies in comments_count | `select comments_count, comments_synced_count from media where id = '<post id>'` before and after the reply | write down whether comments_count changed | |
| P2 | write rate limits | Not testable by hand (the calls run on the server). Do the rows above, then run the §4 query after a busy day | no `rate_limited` result; if any appears, lower the caps (§4) | |
| — | stale id | delete a comment in the Instagram app, then Hide it in in2sight (before the next sync) | "This comment no longer exists on Instagram."; the row disappears | |
| — | permission loss | (only if the owner agrees) remove the comments permission in Instagram → Settings → Website permissions → in2sight, then Hide | "Instagram did not allow this. Reconnect …"; the account's sync status is unchanged; Reconnect restores it | |
Record any answer that differs in `docs/META_PROBE_RESULTS.md` ("Moderation writes", counts and codes only). If P1 fails
(permission error), stop: nothing else matters, the feature stays off.

## 2. Layout: 360 / 768 / 1280 × light/dark, keyboard
| Check | 360 | 768 | 1280 |
|---|---|---|---|
| Comment row: the Moderate (⋯) button is visible, does not push the text sideways | | | |
| The three dialogs: bottom sheet / dialog; Esc and Cancel close; focus returns to the ⋯ button | | | |
| Delete dialog: the confirm stays disabled until DELETE / 删除 is typed | | | |
| Moderation tab: cards stack on phones, two columns from 1024; no sideways page scroll; no range bar | | | |
| Switches and the word form keyboard-operable; errors read by a screen reader (role alert) | | | |
| zh-CN: all strings Chinese, full-width punctuation | | | |
The account tab order is now Overview, Growth, Posts, Stories, Comments, Moderation, Followers.

## 3. Rules, preview and auto-hide (after §1 passed; auto-hide stays OFF until here)
1. Moderation tab → Rules: add "probe" (not whole word). The preview counts the visible probe comments (count only).
2. Switch on "Links": the preview count rises if "probe two www.example.com" is visible.
3. Switch auto-hide ON: the confirm shows the same count. Confirm. Within one tick (≤ 30 min): those comments are hidden
   on Instagram; the log shows "Hidden · By rule: …".
4. Unhide one of them from the log: it stays visible after the next two ticks (never re-hidden).
5. Remove the rules, switch auto-hide off.

## 4. Failure handling
- Rate limits: after a busy day, `select result, count(*) from moderation_log where created_at > now() - interval '1 day' group by 1;`
  — any `rate_limited` → lower `AUTO_HIDE_PER_TICK` (`lib/moderation/auto.ts`) / `MANUAL_PER_MINUTE` (`lib/moderation/service.ts`) (Open question P2) and tell the assistant.
- Pause: if auto-hide pauses, ONE notification "Auto-hide paused" arrives (not one per comment); switching it on again lifts the pause.
- `pending` rows older than 2 minutes show "Outcome unknown — check on Instagram": check that comment on Instagram by hand.
- Sync isolation: `select summary->'moderation' from sync_runs order by started_at desc limit 5;` → counts only; sync outcomes unaffected.
- **Tick time (watch this after enabling auto-hide):** the auto-hide pass runs after the sync lanes (35 s) and the alerts (10 s) in
  its own 5 s window, so a tick can run up to about 50 s into the route's 60 s limit (`maxDuration`). Each Instagram write times out
  after 5 s. After switching auto-hide on, look at the tick durations for a day: Server-Timing of `/api/cron/tick` (if shown) and
  `select started_at, finished_at - started_at as took, summary->'moderation' from sync_runs order by started_at desc limit 20;`
  — any tick near 55 s or more, or a run missing its `finished_at`, means lowering `AUTO_HIDE_PER_TICK` or
  `MODERATION_BUDGET_MS` (`lib/moderation/auto.ts`); tell the assistant.

## 5. Privacy and security (report yes/no and counts only)
- `select column_name from information_schema.columns where table_name = 'moderation_log';` → no text/author/message column.
- `select count(*) from notifications where kind = 'moderation_paused' and (payload - 'username') <> '{}'::jsonb;` → 0 (the payload has only `username`).
- Vercel logs for a day of moderation: no comment text, no names, no `access_token` (search for the probe words: 0 hits).
- Logged out (private window): every server action answers a redirect to /login; nothing changes.
- Deleting an account permanently removes its `moderation_*` rows (cascade): `select count(*) from moderation_log where account_id = '<id>';` → 0.

## 6. Known limits (by design)
Hides and unhides done inside the Instagram app are not seen (P5); replies are not listed as threads (15c reads top-level
comments only; reading thread replies and the hidden flag is a small follow-up plan after probe P5); Simplified/Traditional
Chinese are different words; delete is never automated and never undoable; auto-hide sees only comments the hourly read
stored (posts of the last 30 days).

## What to send if it fails
The step number, the error text shown, the `moderation_log.result` value, and the time. Never the comment text or names.
