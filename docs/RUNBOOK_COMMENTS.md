# Runbook — Comment insights (Plan 15c, read-only)

Status: code complete on local `main`, NOT pushed, NOTHING verified live. The migration is NOT applied to the live database.

The account page's **Comments** tab (Overview, Growth, Posts, Stories, **Comments**, Followers): All comments, Unanswered
questions, Fans, Topics, Not following you. It only READS what the sync already stores (Plan 11b: top-level comments of
feed posts and Reels of the last 30 days, hourly, only for accounts with the comments scope). Nothing here calls
Instagram or changes anything (reply / hide / delete is Plan 15d, planned and not built).

Commenter usernames and comment texts are third-party personal data. In every step below report only yes/no and counts:
never paste usernames, comment texts or screenshots that show them into chats, issues or commits.

## 0. The migration (apply BEFORE deploying; ONLY on the owner's go-ahead)
`supabase/migrations/20261029000001_comment_insights.sql`: three new `security invoker` functions (`comment_list`,
`comment_fans`, `comment_outsiders`) AND **one change to an existing object: it rewrites the `comments` RLS policy
(`comments_owner_select`) into the InitPlan form** (`(select public.is_owner())` instead of `public.is_owner()`, as 12b did for
other tables). The policy keeps the same meaning (owner only); only the evaluation changes. Everything else is additive.
Needs `follower_exports` (15b, applied 2026-10-22). With `.env.local` loaded by the scripts (never print the values; PROGRESS §9):
```
node --env-file=.env.local scripts/sb.mjs migration list        # expect only 20261029000001 pending, nothing remote-only
node --env-file=.env.local scripts/db-probe.mjs rpc:comment_outsiders:'{"p_account":"00000000-0000-0000-0000-000000000000","p_owner":"x","p_offset":0,"p_limit":1}'
                                                                # before: 404 PGRST202 (absent)
node --env-file=.env.local scripts/sb.mjs db push --dry-run     # expect exactly the pending file
node --env-file=.env.local scripts/sb.mjs db push --yes
node --env-file=.env.local scripts/sb.mjs migration list        # expect 13 local / 13 remote / 0 mismatched
node --env-file=.env.local scripts/db-probe.mjs rpc:comment_outsiders:'{"p_account":"00000000-0000-0000-0000-000000000000","p_owner":"x","p_offset":0,"p_limit":1}'
                                                                # after: 401 with code 42501 (exists, anon denied)
```
Before it is applied the tab shows "Comments needs a database update" in every view except Topics (which reads the table
directly): the code works before and after. Rollback, if ever needed: `drop function public.comment_list(...)`, `comment_fans(...)`,
`comment_outsiders(...)` in the SQL editor (the policy rewrite has the same meaning as before and can stay).

## 1. Reconnect for the comments scope (once per account)
1. Accounts page: an account without the scope shows "Reconnect to enable comments". Its Comments tab shows "Comments are
   off for @name" with the same link, and NO list (nothing is read: Instagram answers an empty list without the scope, so
   empty would not mean "no comments").
2. Click the link (it leaves the app tab: `target="_top"`), log in to that Instagram account, approve EVERY permission.
3. SQL editor: `select username, 'instagram_business_manage_comments' = any(granted_scopes) as has_comments from accounts;`
   → true for that account. The Comments tab now shows the five views.
4. Comments arrive with the next hourly comments job (lane 2, after the history import): RUNBOOK_CAPTURE §7 has the counts query.

## 2. A real comment (gate: do this before relying on the feature)
1. From ANOTHER Instagram account, comment on a recent post (posted in the last 30 days) of the connected account:
   one plain comment ("lovely"), one English question ("where is this?"), one Chinese question ("好看吗"), one with a
   hashtag and an emoji.
2. Wait for the comments job (hourly, after the history import; "Sync now" on the Accounts page may pick it up sooner) → All comments lists them
   newest first, with the author, time (your timezone and format settings), likes, and "On your post of …" opening that
   post's Post Lab (with the page's Time Scope).
3. The two questions carry the "Question" badge; the plain one does not. Unanswered questions lists the two questions.
4. From the CONNECTED account, add a top-level comment on the same post that mentions the asker (`@name thanks!`). After the
   next comments job the question shows "Reply seen" and leaves Unanswered questions. A reply INSIDE the thread does NOT
   count (thread replies are not read; the view says so).
5. Search: a word of a comment, then part of the commenter's name (case does not matter; try a Chinese word too). Post
   filter: pick the post. Comment date: Last 7 days, then a custom range. Each is a chip; "Clear all" keeps the view.

## 3. The analysis views
- **Fans**: Top fans ranks by comments then likes; your own comments are not listed. New fans: first comment in the last
  30 days and at least 2 comments. Gone quiet: 3+ comments, none in 30 days, 3+ posts published since (empty at first: the
  history starts at the Reconnect). Each view shows its rule and "1–50 of N people". While the stored history is younger
  than 30 days, New fans shows "History starts {date}: until {date + 30 days} everyone with 2+ comments looks new": check it
  appears for a freshly reconnected account and is gone once the history is 30+ days old.
- **Topics**: needs 20+ comments in the range ("At least 20 comments are needed; this range has N" otherwise). A word must
  appear in 3+ comments from 2+ people; Chinese words (e.g. 颜色, 照片) are counted as words, single characters skipped.
- **Not following you**: without a follower export → "Upload a follower export first" (link to the Followers tab). With one
  (RUNBOOK_FOLLOWERS §2), the basis line names that export's date and size; the people listed commented but are not in
  that export (snapshot-based: anyone who followed after it shows up too).

## 4. Layout: 360 / 768 / 1280 × themes, keyboard, zh-CN
- Every view at 360, 768, 1280 px, light and dark of each theme: no sideways page scroll; the toolbar wraps; rows are cards;
  the Fans / Not following you tables become cards on phones; the three Topics cards stack on phones.
- Keyboard only: the view tabs (arrows + Enter), search, the date panel (Esc closes, focus returns), the post select,
  Advanced → Show only, pagination, the profile and Post Lab links.
- Switch the language to 简体中文: every label, rule and count line is Chinese; dates and numbers follow the format settings.

## 5. Privacy and security (run all; report only yes/no and counts)
1. A long comment (over 500 characters) is cut with "…"; a comment containing `<b>x</b>` shows the characters, not bold text.
2. URLs: only `section`, the comment date, `q` (YOUR search text), `media` (a post id), `only`, `fans`, `page` and the Time
   Scope. No commenter name appears in a URL unless you typed it into the search box — that text then appears in Vercel's
   request logs (like the Followers search): search by words instead of names when that matters.
3. `select count(*) from sync_runs where summary::text ilike '%' || (select author_username from comments limit 1) || '%';` → 0.
4. Signed out (or another browser): `/accounts/<id>?tab=comments` → login; the anon probe of §0 → 401 `42501`.
5. Exports (Excel, PDF report) contain no comment texts or commenter names (this plan adds no export).
6. Deleting an account permanently removes its comments (`on delete cascade`, unchanged since 11b); archiving keeps them.

## 6. Speed (the biggest account)
Open each view with the account that has the most comments; Server-Timing (DevTools → Network → the document) under
1.2 s warm. If Fans or Not following you are slow at thousands of commenters, report the comment count: the planned fix
is an index on `(account_id, lower(author_username))` (a new migration).

## 7. Known limits (by design)
- Only top-level comments of feed posts and Reels posted in the last 30 days at read time, at most 200 per post per read;
  Stories have no comments here (Story replies are private messages). History starts at the Reconnect, so for the first 30
  to 60 days "New fans" cannot tell a long-time fan from a new one (the tab says so until 30 days of history exist).
- Thread replies, Instagram's hidden flag and commenter ids are not read: "Reply seen" is derived from your own top-level
  @mentions; a renamed account counts as a new fan (Plan 15d reads replies and the hidden flag).
- The question rule is a rule (question marks, English question words at the start, Chinese question words anywhere):
  it misses some questions and flags some non-questions. Topics use the newest 1,000 comments of the range.

## What to send if it fails
The step number, the view, the screen width and theme, yes/no per expectation and counts. Never usernames or comment texts.
