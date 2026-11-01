# Runbook: Content tab (Plan 17a) — live checks

Status: code complete, NOT verified live. No migration (the tab reads `post_lab_latest`, applied 2026-10-19). Do these with the owner, signed in with 2FA, on the deployed app. Report numbers and yes/no only.

## 0. Before you start
- The account has at least 20 feed posts in the last 12 months (else Hashtags shows "Needs 20 posts…": correct, but nothing to check).
- Open the account page → **Content** (after Stories). The range bar shows; "Last 30 Days" is the default.

## 1. Numbers match the Post Lab (L1: the latest-known read)
1. Leaderboards, Rank by **Reach**, range "Last 12 months": open the top post (the row links to its Post Lab). Reach on the Post Lab scorecard = reach in the row. Repeat for one Reel and one carousel.
2. Rank by **Profile visits**, then **Follows per 1,000 reach**: for an image post whose Post Lab shows profile visits / follows, the row shows the same number (never a dash while the Post Lab shows one). Reels never appear in these two rankings, and the card says Instagram does not report them for Reels.
3. Rank by **Save rate**: the row's percentage = the Post Lab's save rate.
4. Format = Reels: only Reels are listed. Group by **Tag** and **Week**: each group's best post is the highest of that group; "Week of" follows the week-start setting.

## 2. Guards and empty states
1. Range "Last 7 Days" with few posts: medians say "Under 5 posts", Hashtags says "Needs 20 posts with reach…", "Posts per week and reach" says it needs 8 complete weeks. Nothing shows 0 where a number is unknown.
2. A range with no posts: "No posts in this range".
3. Cadence: posts per week = posts in the range ÷ (days ÷ 7); the longest gap's dates are real posting days; "Since the last post" counts days to today in your timezone; the warning shows only when that is more than twice the usual gap. Story days start at the connect day for an account connected inside the range.
4. Section, Rank by, Format and Group by change the URL (`section`, `metric`, `fmt`, `group`) without the top progress bar; reload keeps them; a range change resets them.

## 3. Speed (L2)
Range "All time" on the account with the most posts: DevTools → Network → the document request → Server-Timing / total time. Expect the tab to stream within the 1.2 s budget of `docs/RUNBOOK_PERF.md` on a warm load. Record the time and the number of posts in the source line. If it is slower, note it (upgrade = a SQL rollup with a migration: a new plan, owner's go-ahead).

## 4. Phone, themes, language
1. 360 px: section tabs scroll sideways, the three selects wrap, tables become cards, no horizontal page scroll. 768 and 1280 px: the Formats and times cards sit two per row from 1024 px.
2. Light and dark of two themes: badges, warning icon and muted text readable.
3. Switch to 简体中文: every label, plural and hint is Chinese.

## Known limits (by design)
Feed posts only (Stories appear as Story days); hashtags from your captions only (not the first comment); medians from 5 posts, hashtag rows from 20 posts with reach, posts-per-week vs reach from 8 complete weeks; the best-time heatmap stays on Overview.
