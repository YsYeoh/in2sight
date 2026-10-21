# Runbook: Growth tab (Plan 15a)

The owner's live check of the account page's **Growth** tab (creator-toolkit design §6 "Audience & growth"; plan: `docs/superpowers/plans/2026-10-28-15a-growth-analytics.md`). Do it together with the assistant, on the deployed app after the code is pushed.

**Status:** Plan 15a is code-complete on local `main`, NOT pushed and NOTHING in it is verified live. There is **no migration** and no sync or capture change: the tab reads existing tables with the owner session (`account_daily`, `account_daily_breakdown`, `media`, `audience_snapshots`, `comments`, and the live `explorer_followers` function for the hourly follower curve). The maths (projection, z-scores) was dry-run in a scratch implementation (plan "Dry run"); the UI has only been exercised in jsdom. Never paste tokens, or other people's names or comments, into a chat or an issue.

**Do §2 first.** The follows / unfollows mapping (`FOLLOW_TYPE` in `lib/instagram/metrics.ts`: FOLLOWER = follows, NON_FOLLOWER = unfollows) is marked UNCERTAIN in the code and has never been checked against real data. If it is swapped, the Follows, Unfollows, Churn and "Follows vs unfollows" numbers are wrong until it is fixed.

## 1. Open it
1. Open an account page. **Pass:** a "Growth" tab sits between Overview and Posts; the range bar shows (Last 7 / 14 / 30 Days visible).
2. Pick another range (for example Last 14 Days). **Pass:** you stay on Growth (`?tab=growth&from=...`) and the cards reload for the new range.
3. Look at it in light and dark of two themes. **Pass:** no raw colours, follows green and unfollows red in both modes, nothing unreadable.
4. Resize to 360, 768 and 1280 px. **Pass:** no sideways page scroll; the KPI row is 2, 3 and 6 columns; chart rows are one column below 1024 px.

## 2. Follows and unfollows mapping (plan open question 7)
In the Supabase SQL editor (read only; owner session or service role, do not change any data):

```sql
select d.day, d.follows, d.unfollows, d.follows - d.unfollows as ig_net, d.followers - p.followers as count_change
from account_daily d
join account_daily p on p.account_id = d.account_id and p.day = d.day - 1
where d.account_id = '<account id>'
  and d.follows is not null and d.followers is not null and p.followers is not null
order by d.day desc limit 30;
```

1. **Pass:** `ig_net` is close to `count_change` on most days (Instagram's numbers lag and round; the sign must agree on days with a clear move).
2. **Fail:** `ig_net` is about the negative of `count_change`: FOLLOWER and NON_FOLLOWER are swapped in `FOLLOW_TYPE`. Stop and tell the owner. The fix is a separate change (the constant plus a one-off `update account_daily set follows = unfollows, unfollows = follows`); do not hand-edit data before that decision.
3. An account under 100 followers has no follows / unfollows at all (Instagram returns nothing): the Growth tab then shows the follower-count change and says so. That is expected, not a failure.

## 3. Followers card
1. Last 7 Days. **Pass:** the Followers chart has hourly points. Last 30 Days: daily points.
2. **Pass:** the change line (absolute and %) matches the first and last counts in the chart.
3. On an account connected inside the range. **Pass:** "Follower history starts <date>" (Instagram has no follower history before the connect day).
4. **Pass:** the projection (7 / 30 / 90 days) names its method (median slope of the last days), the number of days used, the dates, the per-day rate and a confidence word (Low or Medium, never High).
5. An account with fewer than 14 days of follower counts. **Pass:** no projection; the card says why and how many days it has.

## 4. Why panel
1. Pick a day in "Unusual days" (or click a bar with Group by: Day). **Pass:** the URL gains `&day=YYYY-MM-DD` (and `&why=reach` for reach) without a page reload: in the Network tab no document or RSC request appears.
2. Reload, then open the link in a new browser tab. **Pass:** the same day is explained.
3. **Pass:** each reason names its evidence (the post, with a link that opens Instagram in a new tab; Story reach; non-follower share of reach; comments), with "Low / Medium confidence" and the sample size n. The panel says "Patterns, not proof".
4. **Pass:** a day with too little history (fewer than 7 earlier days, fewer than 4 same-weekday values) says so instead of guessing.
5. Switch to a weekly range or Group by: Week. **Pass:** a chart click does nothing and the card says to choose Group by: Day; the Unusual days list still works.
6. Edit the URL by hand to a junk `day` (`day=abc`, a date outside the range) and a junk `why`. **Pass:** ignored, no error.
7. Keyboard: Tab to the Unusual days list and pick a day with Enter. **Pass:** same result as the chart click.
8. **Pass:** today is never flagged unusual; a day before the first captured Story shows unknown, not zero Stories; a post younger than 7 days says too recent to compare.

## 5. Speed
1. Open the Growth tab at Last 30 Days, Last year and All time with warm data; read `Server-Timing` / the Network tab (as in `docs/RUNBOOK_PERF.md`).
2. **Budget:** warm page data at or under 1.2 s p75. Record the numbers.
3. Over budget at All time: note it. The upgrade path is a `security invoker` rollup function for the reach breakdown (one row per bucket) with the same missing-function fallback as Plan 14b (plan open question 8); do not build it before the numbers are known.

## 6. Loyalty and audience
1. **Pass:** "Followers vs non-followers reached" shows the share over time and a per-format table listing only the formats the account used, each with its non-follower share (reach summed over formats: a person reached by a Story and a Reel counts in both, and the card says so).
2. **Pass:** "Audience over time" compares the first and the latest snapshot inside the range (age, gender, countries, cities); a change of 2 points or more with at least 100 people counted in both snapshots is highlighted with an arrow; a country or city outside Instagram's top 45 shows "—" for "then", never 0.
3. An account without audience snapshots (under 100 followers). **Pass:** a stated reason, no empty chart.

## 7. Languages and empty states
1. Switch to Simplified Chinese. **Pass:** every label and reason is Chinese; no raw keys, no `undefined`, `NaN` or `Infinity` anywhere.
2. A brand-new account (a few days of data). **Pass:** every card shows a reason or a "data starts" line instead of a number.

## Not captured (needs a sync change if wanted)
Engaged-audience demographics; demographics for `last_30_days` / `last_90_days` (only `this_month` is stored); follower counts before the connect day; per-post follower vs non-follower split; intraday reach.
