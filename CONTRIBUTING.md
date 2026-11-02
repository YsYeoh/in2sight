# Contributing to in2Sight

Thanks for helping. in2Sight is a small, careful project: it handles Instagram tokens and other people's comments, so the rules below are strict on purpose. Issues, ideas and pull requests are all welcome.

## Before you start

- **Read** [`README.md`](README.md), [`docs/MANUAL.md`](docs/MANUAL.md) (to run it) and [`CLAUDE.md`](CLAUDE.md) (the code and UI rules, written for both people and AI agents).
- **Design first for anything big.** The source of truth is [`docs/SPEC.md`](docs/SPEC.md) and the plans in [`docs/superpowers/plans/`](docs/superpowers/plans/). For a new feature or a design change, open an issue and agree the approach before you write code; a pull request that contradicts the spec will be asked to change the spec first.
- **Security problems:** do not open a public issue. Use **Security → Report a vulnerability** on GitHub (see [`SECURITY.md`](SECURITY.md)).
- **Never post** access tokens, `.env` contents, or real follower or commenter data in issues, pull requests or screenshots.

## Set up

```bash
git clone https://github.com/<you>/in2sight.git && cd in2sight
npm install
npm test                # unit and component tests, no secrets or network needed
npm run dev             # http://localhost:3000 (needs .env.local, see docs/MANUAL.md)
npm run check           # lint + typecheck + tests + production build: must pass
```

You can work on most of the code (analysis, components, tests) without a Supabase project or a Meta app: tests use fakes and never connect to a service.

## The rules that most often fail a review

| Area | Rule |
|---|---|
| Tests | Analysis logic is a **pure function** in `lib/analysis/` with a Vitest test. Sync and API code gets a mocked-`fetch` test. Fix a bug with a failing test first. |
| Text | **Every UI string goes through next-intl**, in both `messages/en.json` and `messages/zh-CN.json`. Never hard-code text. Backend code returns error keys, not prose. |
| Look | Only semantic tokens (`bg-background`, `text-foreground`, `--chart-n`, `--brand-n`), never raw colours. Every component must work in all four themes, light and dark, and at 360, 768 and 1280 px. |
| Formats | Dates, times and numbers only through `lib/format.ts`; never call `toLocaleString` or `toLocaleDateString` inline. |
| Reuse | Build from `components/ui/` and `components/shared/`. Metrics come from the registry `lib/metrics.ts`. Extract a component on its second use, not before. |
| Database | Every change is a **new SQL file** in `supabase/migrations/` (never edit an applied one), with row-level security. `account_tokens` is service-role only. |
| Secrets | Never log, print or return a token or secret. No `NEXT_PUBLIC_` variable except the Supabase URL and publishable key. |
| Small | Smallest thing that works. No new dependency without saying why in the pull request. |
| UI standards | Read [`docs/UI_STANDARDS.md`](docs/UI_STANDARDS.md) before changing a screen; guard tests enforce parts of it. |

## Pull requests

1. Fork, branch from `main`, keep the change focused.
2. Run `npm run check`; it must pass.
3. Update the docs you touched (`docs/TODO.md` for progress, the matching `docs/RUNBOOK_*.md` for live checks).
4. Say in the description what you changed, why, and how you tested it. Mark anything you could **not** verify (for example against a real Instagram account).
5. AI-assisted contributions are welcome; say so, and make sure you understand and have tested what you submit.

Commits use short conventional messages (`feat(scope): ...`, `fix(scope): ...`, `docs: ...`).

## Good first tasks

Small, self-contained items from [`docs/TODO.md`](docs/TODO.md) ("Known" lists). Comment on the matching issue, or open one, before you start.

- The weekday filter select is always Sunday-first; make it follow the week-start preference.
- The Overview comparison chart's bucket drill works by mouse only; add a keyboard path.
- The breadcrumb trail drops the tag, weekday and hour filters.
- Removing a filter chip drops keyboard focus to the page; move it to the next chip or the toolbar.
- Follower export upload accepts only the extracted JSON; add `.zip` support with inflated-size limits.
- Carousel child covers are not captured yet.
- More languages: add a catalogue next to `messages/en.json` (the key-parity test tells you what is missing).
- A demo mode with sample data, so people can try the dashboards without connecting an Instagram account.

## Conduct

Be kind and assume good faith. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
