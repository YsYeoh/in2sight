# Runbook: Auto-tagging (Plan 17c) — live checks

Nothing here has been verified live. Do it with the owner, signed in with 2FA, on the deployed app (`<app-url>`). The SQL was verified on PGlite (Postgres 17 in WASM) on top of all migrations (see the plan's "Scratch-run result"); the UI only in jsdom tests. Report counts and yes/no only. Use the owner's account for every check; never paste captions, hashtags or handles into a chat or an issue.

## 0. The migration — on the owner's go-ahead, BEFORE deploying
`supabase/migrations/20261102000001_tag_rules.sql`: file written, NOT applied. It adds `tag_rules`, `media_tag_rejections`, `media_tags.source` (default `manual` for every existing row) and the trigger `media_tags_skip_rejected`. Nothing existing is dropped. Supabase CLI 3.x defaults to the local Docker stack, so every `sb.mjs` command carries `--remote`.

    node --env-file=.env.local scripts/sb.mjs migration list --remote        # expect only 20261102000001 pending, nothing remote-only
    node --env-file=.env.local scripts/db-probe.mjs table:tag_rules table:media_tag_rejections   # before: 404 PGRST205 (absent)
    node --env-file=.env.local scripts/sb.mjs db push --remote --dry-run     # expect exactly that file
    node --env-file=.env.local scripts/sb.mjs db push --remote --yes
    node --env-file=.env.local scripts/sb.mjs migration list --remote        # N local / N remote / 0 mismatched
    node --env-file=.env.local scripts/db-probe.mjs table:tag_rules table:media_tag_rejections   # after: 401 / 42501 (exists, anon denied)

Before `db push`, the dry-run must list exactly one pending file; if it lists an older migration too, stop and ask the owner.

Not checked from the CLI: that the signed-in owner can read and write the tables (RLS passes `is_owner()`); the first rule added in section 1 is that check.

Without it: the Tags page shows "Automatic tagging needs a database update.", the sync skips the rules, removing a tag still works, and the two new files in Settings → Data & privacy → Export fail with the usual "export failed" message.

## 1. Rules and the dialog (360 / 768 / 1280 px, light and dark)
1. Tags → a tag → "Rules (0)" → add a hashtag the owner really uses, a word, and "Format is Reels". The button now reads "Rules (3)".
2. Add the same hashtag again in another case, and with a full-width `＃`: refused with "This tag already has that rule."
3. Remove one rule: the tags it added stay on the posts.
4. The dialog is a bottom sheet on a phone (360 px): no horizontal scroll, a long rule wraps, errors are read out, focus returns to the Rules button on close.

## 2. Apply to existing posts (L2)
1. Press "Apply to existing posts": note the count. Check 3 of those posts in Post Lab: the caption really has the hashtag / word (also a Chinese one if the owner uses them; also a hashtag next to an emoji or a line break). Press Apply: "Tagged N posts."; the post counts in the Tags table change.
2. Press it again: "No post would change." (idempotent).
3. A post the owner had tagged BY HAND with that tag before: still exactly one tag, unchanged.

## 3. Removal memory (L1)
1. In a post's tag picker, untick an automatic tag and save.
2. Apply to existing posts again: the count does not include that post; after Apply the tag is still off.
3. Wait for the next sync tick (or "Sync now"): still off. Re-tick it by hand: it stays (manual wins).
4. (Assistant, owner present) PostgREST check: an `upsert` of that pair with `source: 'auto'` through the owner session answers 201 and the row does NOT appear (the trigger). Never paste row values into chats.

## 4. New posts and the tick (L3)
1. Publish a new post or Reel with a rule's hashtag. After the next tick it has the tag (source `auto`).
2. Compare 3 ticks' durations before and after creating rules (Server-Timing or `sync_runs` durations): no visible change.

## 5. Export and delete
1. Settings → Data & privacy → Download all: 21 files (23 with other people's data); `tag_rules` and `media_tag_rejections` open as JSON.
2. Deleting a tag removes its rules (Tags → Delete).

Record outcomes here; tick `docs/TODO.md` (Plan 17c section) only after the owner has looked.
