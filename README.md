# in2sight

**Open-source Instagram analytics for creators who want to own their data.**

in2sight connects your Instagram accounts through Meta's official API, saves a daily record of how they grow, and turns it into answers: what is working, what changed, and what to post next. Your numbers live in a database you control, not in a vendor's.

> **Status: working prototype, self-hosted, one owner per deployment.** The core runs against real accounts. Many later features are code-complete and tested but still waiting on live walkthroughs. See [Project status](#project-status) for the honest list, and [Roadmap](#roadmap) for what comes next, including the step from "one person's tool" to "something anyone can use".

## Why this exists

Instagram's own Insights screen forgets. Account-level numbers reach back only about 90 days, Stories disappear after 24 hours, and there is no way to compare accounts, tag your content, ask "what worked in the last six months", or export it all. Creators who run more than one account end up with screenshots and spreadsheets.

in2sight fixes that by **recording continuously** (every 30 minutes for Stories, daily for everything else) and keeping the history. The longer it runs, the more it can tell you.

## What it does

**Connect and record**
- Connect one or more Instagram Creator or Business accounts with Instagram's own login. in2sight never sees your Instagram password.
- A scheduled sync stores follower and reach history, every post's metrics over time, Story metrics (captured while the Story is live), audience demographics and covers. A new account fills in newest-first, so the dashboard is useful within minutes.
- One failing account never stops the others. Tokens refresh automatically and you are alerted if one cannot be renewed.

**Trends and analysis**
- A shared time range (presets, custom, week/month/quarter, compare with an earlier period) in the URL, so any view can be bookmarked.
- Growth: followers curve with a stated-method projection, follows vs unfollows, loyal vs discovery reach, and "why did this change?" with unusual-day detection.
- Content: post and Story lists, a per-post page with a scorecard against your own history, caption analysis, tags (content pillars), a calendar, and a **Content lab** with leaderboards, formats and times, hashtags and posting cadence.
- Explorer: pick a metric and a dimension, drill down, save the view, export it.
- Every analysis states its basis: sample size, confidence, and a plain reason when there is not enough data. A missing number is shown as missing, never as zero.

**Decisions and follow-through**
- Comments: unanswered questions, top fans, topics, and commenters who do not follow you. Optional moderation (reply, hide, delete, banned-word rules), always confirmed and logged.
- Alerts and Web Push (installable PWA) for unusual events, token problems and sync failures.
- Excel and PDF reports.

**Yours to keep or erase**
- Export every table as JSON, see how much storage you use, or delete everything from Settings. Third-party data (commenter names, follower lists) stays out of exports unless you tick the box.

English and 简体中文. Light and dark themes, four colour themes, phone / tablet / desktop layouts.

## Built for trust

Instagram data is personal, and so is the data of the people who comment. The design assumes that.

- **Owner-only by default.** Row-level security on every table; the login requires a password plus TOTP two-factor; sign-ups are disabled.
- **Tokens never reach the browser.** Instagram access tokens live in a table only the server's service role can read. Secrets are server-side and never logged.
- **Official API only.** Instagram API with Instagram Login (`graph.instagram.com`), read scopes plus the comment scope; no scraping, no password collection.
- **Fail closed.** The sync endpoint refuses requests without its secret; delete-all needs your password and a typed confirmation; writes to Instagram are confirmed, logged and reversible where Instagram allows.
- **Tested.** 309 test files and about 3,100 tests, including guard tests that fail the build if a log line, a client bundle or a route could expose a secret or third-party data.

Reviews so far were AI-assisted code reviews; the security reviews of the sign-in, password and data-privacy work found no Critical issues. **No independent human security audit has been done yet.** See [Roadmap](#roadmap).

## Tech stack

Next.js 16 (App Router, TypeScript strict) on Vercel · Supabase (Postgres, Auth, Storage) · Tailwind + shadcn/Radix · Recharts · next-intl · Vitest + Testing Library · `web-push` · `write-excel-file` · `puppeteer-core` for PDF. Small on purpose: plain `fetch` for the Meta API (no SDK), analysis as pure, unit-tested functions in [`lib/analysis/`](lib/analysis/), every database change as a SQL migration in [`supabase/migrations/`](supabase/migrations/).

## Project status

| Area | State |
|---|---|
| Connect, sync, dashboards, tags, alerts, PWA, exports (core) | Built and used against two real accounts |
| Growth, Followers, Comments, Moderation, Settings, Security, Data & privacy, Content lab | **Code complete, tested, deployed or ready to deploy; live walkthroughs pending.** Each has a runbook in [`docs/`](docs/) listing the exact checks |
| Writing to Instagram (reply / hide / delete, auto-hide) | Implemented but **never yet exercised against live Instagram**; auto-hide is off by default and stays off until its probes pass |
| Automated checks | `npm run check` (lint, typecheck, tests, build) passes |
| Independent security review | Not done |
| Multiple users / hosted service | **Not built.** The design is deliberately single-owner today |

## Roadmap

The detailed plans live in [`docs/superpowers/plans/`](docs/superpowers/plans/). Items move only when their live checks pass.

### Done
- Foundation, UI kit, auth with 2FA, Instagram connect, sync engine, analysis and dashboards, alerts, PWA, exports.
- Time Scope, Explorer, covers and Post Lab, Posts/Stories lists, app-shell tabs, Growth, Followers, Comments, Moderation.
- Settings redesign, password reset and session control, data export and delete-all.
- **Content lab** (leaderboards, formats and times, hashtags, cadence).

### Now: verify what is built
- Walk every runbook with real data, fix what fails, and publish the results.
- Record real Instagram API fixtures so contributors can run the sync tests offline.

### Next: weekly planning tools
Planned in detail, none needing a new Meta API call.
1. **Insights feed and "Today"**: ranked, evidence-backed findings and a ten-second daily briefing.
2. **Auto-tagging**: hashtag and keyword rules that tag posts for you and never overwrite a manual choice.
3. **Goals and weekly / monthly digest**: pace and forecast against your own targets, one page for the Monday review.
4. **Smart alerts**: quiet hours and one morning summary instead of many pings.
5. **Planner board**: ideas to drafts to scheduled slots, linked to the post once it is live (it plans; it does not publish).

### Later
- Optional plain-language weekly summary written by an AI model: opt-in, with a clear statement of what is sent where.
- Shareable read-only report links with expiry.

### Proposed: from one person's tool to something anyone can use
Not designed or started; this is the work additional support would fund.
- **Multi-user mode:** separate workspaces with per-user data isolation and sign-up, replacing the single-owner model.
- **Meta App Review and business verification,** so people can connect their own accounts without being added by hand as testers.
- **Independent security audit** and a public privacy and data-handling policy, including Meta's data-deletion requirements.
- **One-click self-host** (deploy button, guided setup) and a hosted option for people who do not want to run it.
- **Documentation and community:** contributor guide, fixtures, demo mode with sample data, more languages.

## Run it yourself

You need a Supabase project, a Vercel project (or any Node host), a free Meta developer app, and an Instagram Creator or Business account. Allow about an hour the first time.

1. Follow [`docs/SETUP.md`](docs/SETUP.md), then [`docs/SETUP_SUPABASE.md`](docs/SETUP_SUPABASE.md) and [`docs/META_SETUP.md`](docs/META_SETUP.md).
2. Copy `.env.example` to `.env.local`, fill it in, then `npm run check:env` (it checks names and formats and never prints a value).
3. Apply the migrations in [`supabase/migrations/`](supabase/migrations/) in order.
4. Point a scheduler (for example cron-job.org) at `/api/cron/tick` every 30 minutes ([`docs/RUNBOOK_SYNC.md`](docs/RUNBOOK_SYNC.md)).

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit and component tests
npm run check      # lint + typecheck + tests + build
```

A Meta app left in Development mode works for accounts you add to it, with no App Review, which is why today's version is a personal tool.

## Documentation

- Design: [`docs/SPEC.md`](docs/SPEC.md) · Progress: [`docs/TODO.md`](docs/TODO.md) and [`docs/PROGRESS.md`](docs/PROGRESS.md)
- UI rules: [`docs/UI_STANDARDS.md`](docs/UI_STANDARDS.md) · Visual reference: [`docs/mockups/`](docs/mockups/README.md)
- One runbook per feature: `docs/RUNBOOK_*.md`

## Contributing

Issues and ideas are welcome. Before opening a pull request, read [`CLAUDE.md`](CLAUDE.md) (code and UI rules), run `npm run check`, add a test for any analysis logic, and put every new UI string in both `messages/en.json` and `messages/zh-CN.json`. Please do not post access tokens, `.env` contents or real follower or commenter data in issues. To report a security problem, contact the maintainer privately rather than opening a public issue.

## License

[MIT](LICENSE). Use it, change it, and host it yourself.

## Disclaimer

in2sight is an independent project. It is not affiliated with, endorsed by, or sponsored by Meta or Instagram. Instagram is a trademark of Meta Platforms, Inc.
