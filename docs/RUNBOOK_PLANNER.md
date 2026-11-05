# Runbook: Planner board (Plan 17f) — live checks

The planner never talks to Instagram: nothing in it publishes, schedules or reminds. Nothing here has been tried on real data yet: the code was tested with fakes and the migration on PGlite only (plan `docs/superpowers/plans/2026-11-01-17f-planner-board.md`, "Scratch-run result"). These checks need the owner (login with 2FA, real accounts) on the deployed app (`<app-url>`). Report yes / no and counts; card texts are the owner's own.

## 0. The migration — on the owner's go-ahead, BEFORE deploying
`supabase/migrations/20261105000001_planner_items.sql` adds one table (`planner_items`, owner-only RLS, deleted with its account). The file was applied 2026-11-05 (dry-run listed exactly this file; `migration list` 21 / 21; anon probe 401 / 42501; advisors unchanged), before the code was pushed. Nothing existing is dropped. Supabase CLI 3.x defaults to the local Docker stack, so every `sb.mjs` command carries `--remote` (`db query` against production needs an extra consent flag and is not used).

    node --env-file=.env.local scripts/sb.mjs migration list --remote        # expect only 20261105000001 pending (plus any earlier pending file); nothing remote-only
    node --env-file=.env.local scripts/db-probe.mjs table:planner_items      # before: 404 PGRST205 (absent)
    node --env-file=.env.local scripts/sb.mjs db push --remote --dry-run     # expect exactly the pending file(s)
    node --env-file=.env.local scripts/sb.mjs db push --remote --yes
    node --env-file=.env.local scripts/sb.mjs migration list --remote        # expect N local / N remote / 0 mismatched
    node --env-file=.env.local scripts/db-probe.mjs table:planner_items      # after: 401 with code 42501 (exists, anon denied)

Before `db push`, the dry-run must list exactly the files you expect; if it lists an older migration too, stop and ask the owner.

Not checked from the CLI: that the signed-in owner can read and write `planner_items` (RLS passes `is_owner()`); the first card saved in section 1 is that check.

Until it is applied the Board tab says "The planner needs a database update" and every action answers `needs_update` (check once on a preview if convenient). Settings → Data & privacy → Export fails on the `planner_items` file with the usual export error for a missing table.

## 1. The board (L1, L2)
1. Side nav → Plan → Board tab (`/plan/board`; desktop sidebar, tablet rail, phone bottom bar). The tab strip shows Digest, Goals, Board at 360 px (L1).
2. New idea → title, notes with two lines, format Reel, a planned day and hour, two tags → Save. The card shows them; the notes keep their line break; a title like `<b>x</b>` shows as text.
3. Move the card with → to Drafting, then Ready, then ← back: the card moves, a screen reader announces "Moved … to …", the focus stays on the card (Tab continues from it).
4. Keyboard only: Tab to a card's → button, Enter. Escape closes the dialog and the focus returns.
5. Drag a card to another column with the mouse in Chrome, Edge, Firefox and Safari, inside an app-shell tab (L2). If a browser refuses, the arrows still work: note which.
6. Two accounts: the Account filter shows only that account's cards and survives a reload; "All accounts" shows the handle on each card.
7. 360 / 768 / 1280 px, light and dark of all 4 themes: columns stack on phones, 2 per row on tablets, 4 on wide screens; the dialog is a bottom sheet on phones.

## 2. Suggest a time (L3)
Open a card of an account with 30+ feed posts → Suggest a time. Up to 3 buttons in the next 7 days, never on a day that already has a planned card of that account, with "… N posts. Pattern, not proof." The slots are among the strongest cells of the account Overview's best-time heatmap ("your post performance"). An account with fewer than 30 posts says "Needs ~30+ posts for a reliable pattern (n = … posts)".

## 3. Link a real post (L4)
1. Plan a card (Reel, today, the hour you will post) and move it to Ready.
2. Post a Reel on Instagram at about that time. After the next sync (up to 30 minutes), open the card: the Reel is listed first with "Matches the planned time".
3. Pick it → Save: the card moves to Posted and shows "Open the post", which opens the right Post Lab page.
4. Move it back to Ready: the link is gone. Link it again; open another card: that Reel is not offered there.

## 4. Data (L5)
1. Tags and the planned day / hour saved through the real PostgREST come back unchanged after a reload (uuid[] and date + smallint, L5).
2. Settings → Data & privacy → Export: `planner_items` is in the list and downloads.
3. Delete a tag that a card uses: the card simply stops showing it.
4. (Only when the owner wants it) an account deleted for good removes its cards.

## 5. Privacy
No request to Instagram happens while using the board (DevTools Network: only same-origin requests). Nothing about cards appears in the sync log, notifications or push.

## Known limits (by design)
No reminders, no Calendar entries, no manual order, only posts of the last 30 days can be newly linked, at most 500 cards, touch devices move cards with the arrows. "Storage used" counts the table only inside the database total (`data_usage()` lists tables literally and was not replaced).
