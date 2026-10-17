# Plan 11b: Data Capture v2 (remainder) — granted scopes, capability memory, Story + per-media extras, media fields, covers to private Storage, comments, raw archive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture everything Instagram gives us that cannot be re-fetched later — Story extras (SWIPE_FORWARD, follows, profile visits, profile activity) while the Story is live, per-media extras (feed follows/profile visits/profile activity, Reels watch time/skip rate) with a 7-day checkpoint, the media fields we currently drop, cover images copied into a private Storage bucket (Stories on first sight), comments (only when the comments scope is really granted), and the raw JSON of account-level insights — without ever letting an extra break the core capture.

**Architecture:** One additive migration. The OAuth code exchange now returns the `permissions` Meta granted; they are stored on `accounts.granted_scopes` and `hasScope()` gates comments (an empty comments list is never taken as "no comments"). Every optional Meta call is a separate, non-fatal call; an "unsupported metric/field" answer (code 100 + a fixed message pattern, kept only as a boolean) is remembered in `sync_state.capabilities` so it is not re-requested, while transient errors never touch that memory. Story extras and Story covers run inside the Stories job AFTER the core capture; per-media extras run after the core media loop with a per-run call budget; post covers and comments are new lane-2-only jobs (`covers`, `comments`) that run after the history import and report the reserved progress stages. Raw account-insights bodies are archived (deduped by hash, size-capped) through a callback the data client calls; the archive write is best-effort and time-capped.

**Tech Stack:** Next.js 16 App Router (route handler), Supabase Postgres + RLS + Storage (private bucket, admin client only), next-intl 4, Vitest. **New dependencies: none** (`node:crypto` for the body hash, `fetch` for the CDN).

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b (Plan 11 scope, data policy), §4 (covers: data, Storage, serving, SSRF rules, delete), §5 (Post Lab metrics + 7-day checkpoint), §8 (cross-cutting); `docs/TODO.md` §6c; verified Meta facts `docs/META_PROBE_RESULTS.md` (authoritative); `docs/HANDOVER.md` §1b/§1c. Project rules: `CLAUDE.md` (binding).

**Dry run (2026-10-17):** every task's code was executed once, in order, in a throwaway clone outside the repo (fresh `npm ci`, from `main` 97625c6, no new packages). See "Dry-run result" at the end. Nothing touched Supabase or Meta.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

_(filled in below as tasks land)_

## Out of scope

`MediaThumb` / grid / filmstrip / Post Lab / Explorer / Time Scope UI (Plans 12–13); comment moderation (reply/hide/delete) and comment replies; capture of carousel CHILD covers (the table has the columns; only the parent cover is captured); reading `X-Business-Use-Case-Usage`; Settings → Data storage dashboard.

## Global Constraints

- Ponytail: smallest thing that works; no abstraction with one implementation; **no new dependencies**.
- TypeScript strict. Every new Meta metric/field name lives in `lib/instagram/metrics.ts` (re-verify against Meta docs when touching it).
- All DB changes in the NEW file `supabase/migrations/20261022000001_capture_v2b.sql`; never edit an applied migration (latest applied: `20261021000001_sync_progress.sql`). RLS on every new table: owner select via `public.is_owner()`, `revoke all … from anon, authenticated; grant select … to authenticated`; writes only via the admin client. **Apply the migration BEFORE deploying the code.**
- Storage bucket `covers` is private (`public = false`), created by the migration; NO storage policies; only the admin client touches objects. Object key `{account_id}/{media_id}.jpg`.
- Extras, covers, comments and the archive are NON-FATAL for the core capture: only auth + rate-limit errors (`isFatalIgError`) may stop a job; the core Story/media snapshot is written before any extra call.
- Tokens, CDN URLs (they carry signatures), comment texts and third-party usernames are never logged, never put in errors, progress rows, summaries or route responses other than the owner's own data reads.
- Cover fetch: `https` only, hostname `fbcdn.net` / `cdninstagram.com` or a subdomain of them (parsed with `URL`), redirects followed manually only to allowlisted hosts (max 3), 10 s timeout, max 5 MB, content type `image/jpeg|png|webp` only (never SVG).
- The cover route is session-protected: `assertOwner(h)` with `h` copied onto EVERY response; `lib/auth/route-policy.ts` is NOT changed (no public exemption).
- Every UI string via next-intl, new keys in BOTH `messages/en.json` and `messages/zh-CN.json` (real Simplified Chinese). Backend returns keys.
- Tests: mocked fetch/fakes only, no network, deterministic clocks, Vitest timeout 20 s. Windows: files have CRLF working-copy endings; create/modify files with the Write/Edit tools (never shell heredocs).
- `npm run check` passes after every task. Commits: conventional, `git add` specific paths, `git commit -m "<msg>" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`. Don't push.

## Review Focus

_(filled in below)_

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261022000001_capture_v2b.sql` (new) | granted_scopes, capabilities, media_metrics extras, media fields + cover columns, `media_children`, `covers` bucket, `comments`, `api_snapshots` |
| `lib/instagram/oauth.ts` | `exchangeCode` returns `grantedScopes`; `InstagramApiError.unsupported` flag |
| `lib/instagram/metrics.ts` | extra metric groups, field lists (media, story, cover, comments) |
| `lib/instagram/parse.ts` | media details, comments page parsers |
| `lib/instagram/data.ts` | SWIPE_FORWARD, `extraInsights`, `mediaCover`, `commentsPage`, archive callback, `isUnsupported`, `isFatalIgError` |
| `lib/accounts/{types,service,supabase-store,scopes}.ts` | `grantedScopes` on accounts, `hasScope` |
| `lib/sync/capabilities.ts` (new) | pure capability-memory helpers |
| `lib/sync/extras.ts` (new) | one non-fatal call per metric group with capability memory and call budget |
| `lib/sync/covers.ts` (new) | URL pick, CDN allowlist, safe image fetch, cover due/backoff, capture |
| `lib/sync/schedule.ts` | jobs `covers`, `comments` (lane 2 only), 7-day checkpoint |
| `lib/sync/run-account.ts` | wiring: story extras + covers, media extras, covers job, comments job, archive |
| `lib/sync/store.ts` | new persistence methods, capabilities, `removeAccountCovers` |
| `lib/sync/tick.ts` | lane 2 also runs accounts with covers/comments due; `cdnFetch` dep |
| `app/api/media/[id]/cover/route.ts` (new) | owner-only cover stream |
| `app/(app)/accounts/actions.ts` | permanent delete also removes Storage objects |
| `components/accounts/AccountsView.tsx`, `messages/*.json` | "Reconnect to enable comments" hint |
| `tests/fixtures/sync-fakes.ts` | new fake methods |
| `docs/RUNBOOK_CAPTURE.md` (new), `docs/TODO.md`, `docs/HANDOVER.md`, `docs/SPEC.md` | runbook, honest ticks, SPEC §5 rows |

## Tasks

1. Migration `20261022000001_capture_v2b.sql` (+ migration test)
2. Granted scopes: code exchange → `accounts.granted_scopes`, `hasScope`
3. Accounts UI: "Reconnect to enable comments" hint (i18n)
4. Capability memory: `unsupported` error flag, pure helpers, persisted in `sync_state`
5. Metric constants + data client: SWIPE_FORWARD, `extraInsights`, extras columns in the store
6. Story extras (separate non-fatal calls after the core Story capture)
7. Per-media extras + 7-day checkpoint
8. Media fields + `media_children` (listing details, Story-field fallback)
9. Safe cover fetch (`lib/sync/covers.ts`: allowlist, redirects, size, type, timeout)
10. Cover persistence + capture (store, `mediaCover`, due/backoff, Story covers on first sight)
11. `covers` job in lane 2 (schedule, runner, tick lane-2 selection)
12. Cover route `GET /api/media/[id]/cover` + Storage cleanup on permanent delete
13. Comments ingestion (scope-gated `comments` job)
14. Raw response archive (`api_snapshots`)
15. Docs: RUNBOOK_CAPTURE, TODO, HANDOVER, SPEC §5/§6

---
