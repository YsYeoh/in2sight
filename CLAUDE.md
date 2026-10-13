# in2sight

Private dashboard that pulls Instagram insights (Meta API) for the owner's multiple accounts and analyses them. Stack: Next.js (TS) on Vercel, Supabase (Postgres + Auth), Vercel Cron.

Source of truth: `docs/SPEC.md` (design), `docs/TODO.md` (progress), `docs/META_SETUP.md` (owner setup). Keep TODO checked off as work lands. If the code and spec disagree, stop and ask which is right.

## Commands
- `npm run dev` — dev server (http://localhost:3000, redirects to `/styleguide` until real pages exist)
- `npm test` — Vitest (unit + component tests in `tests/`); `npm run test:watch` while developing
- `npm run check` — lint + typecheck + tests + build; must pass before any task is called done
- Mockups (visual reference): `node docs/mockups/serve.cjs` → http://localhost:5173/

## Workflow rules
- **Do not build ahead of approval.** Design changes go through `superpowers:brainstorming` → update SPEC first.
- Milestone order is in TODO. Don't start UI before sync works against a real account.
- Don't commit or push unless asked. Commit messages end with the Co-Authored-By line from the harness. Never force-push `main`.
- Don't create external resources (Supabase project, Vercel project, Meta app changes) without explicit confirmation.

## Code rules
- Ponytail: smallest thing that works. No SDKs where `fetch` suffices, no abstractions with one implementation, no new dependency without saying why.
- TypeScript strict. Meta API metric names live in one constants file; re-verify against Meta docs when touching them (they get deprecated).
- All DB changes are SQL files in `supabase/migrations/`. RLS on every table. `account_tokens` is service-role only.
- Analysis logic = pure functions in `lib/analysis/` with Vitest tests. Sync/API code gets mocked-fetch tests.
- Sync must isolate failures per account; never let one bad token stop the rest.

## Frontend rules (owner's)
- **Reuse:** build from `components/ui/` (shadcn) and `components/shared/`. Inline first; extract on the second use. Pages = wiring only, logic in `lib/`.
- **Flexible, not over-built:** metrics come from the registry `lib/metrics.ts`; a new metric is one entry. No plugin systems or config for values that never change.
- **i18n:** every UI string via next-intl (`messages/en.json`, `messages/zh.json`). Never hardcode text. New keys go in both files. Backend returns error keys, not prose.
- **Theming:** only semantic tokens (`bg-background`, `text-foreground`, `--chart-n`), never raw colors. Every new component must look right in all themes, light and dark.
- **Responsive:** mobile-first. Every component and page must work at 360px, 768px and 1280px+. Use the shared responsive primitives; no fixed pixel widths on layout containers.
- **Formats:** dates, times and numbers only via `lib/format.ts` (honours the user's format settings). Never call `toLocaleDateString` / `toLocaleString` inline.
- **Motion:** gate heavy effects (particles, 3D) behind the shared motion check (reduced-motion, mobile, Save-Data). The mockups in `.superpowers/brainstorm/` are the visual reference.

## Security rules
- Never commit `.env*`. Never log, print, or return access tokens or secrets. No tokens in client bundles (`NEXT_PUBLIC_` is for the Supabase URL/anon key only).
- Cron endpoints require `CRON_SECRET`. Service-role key is server-only.

## Skills for this project
| When | Skill |
|---|---|
| Any design change / new feature | `superpowers:brainstorming` |
| Turning approved spec into steps | `superpowers:writing-plans`, then `superpowers:executing-plans` |
| Sync + analysis logic | `superpowers:test-driven-development` |
| Any bug or failing sync | `superpowers:systematic-debugging` |
| Building dashboard pages | `frontend-design` (+ `dataviz` for charts) |
| DB / Supabase work | Supabase MCP tools (inspect tables first; run advisors after RLS changes) |
| Before saying "done" | `superpowers:verification-before-completion` |
| Before merging | `code-review`, `security-review` |
| Over-engineering check | `ponytail:ponytail-review` |
| Later: AI summaries (C) | `claude-api` |
