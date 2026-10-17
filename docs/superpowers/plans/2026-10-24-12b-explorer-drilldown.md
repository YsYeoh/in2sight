# Plan 12b: Rollups + Explorer + Drill-down — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner zoom vertically (portfolio → group → account → format → single item → its follower curve → audience slice) and horizontally (accounts, groups, formats, tags, weekdays, hours, periods) through a new desktop-first `/explorer` page with a whitelisted metric/dimension registry, a linked chart + table, saved views and an Excel export of the current view; and make the existing Overview / account pages drill into it — all driven by the Plan 12a Time Scope.

**Architecture:** One additive migration adds five `security invoker` SQL functions (RLS still applies, execute granted to `authenticated` only) that return small, additive rollups — account days bucketed by day/week/month, posts with their latest snapshot grouped by account/format/tag/weekday/hour/time bucket, a capped post list, and a follower curve from `follower_snapshots` — plus the owner-authored `explorer_views` table. TypeScript never sends SQL text: the URL state is parsed into an allow-listed `ExplorerState`, the reader maps it to one of the fixed RPCs with typed arguments, and pure functions in `lib/analysis/explorer.ts` turn the additive parts into metric values through the registry in `lib/metrics.ts` (a new metric = one entry), combine accounts into groups, join the comparison period, and compute drill targets and the breadcrumb trail. The page is wiring only.

**Tech Stack:** Next.js 16.4 App Router, TypeScript strict, Supabase Postgres (SQL functions, RLS), `@supabase/supabase-js` `rpc()` with the owner-session client, next-intl 4, Recharts 3 (installed), `write-excel-file` (installed), Vitest 5 + Testing Library + jsdom. **New dependencies: none.**

**Spec:** `docs/superpowers/specs/2026-10-15-creator-toolkit-design.md` §0b ("Drill-down & time scope", "Data policy", Round 3 decisions) and §8 (cross-cutting rules); `docs/SPEC.md` §5, §7, §7b, §8b; Plan 12a `docs/superpowers/plans/2026-10-23-12a-time-scope.md` (consumed, see "Assumptions about 12a"). Project rules: `CLAUDE.md` (binding).

**Status of this file:** written incrementally; sections marked _(pending)_ are filled by later commits of the planner.

## Decisions taken in this plan (owner: please confirm the ones marked ⚠)

_(pending — filled in the next commit)_

## Assumptions about 12a

_(pending — filled once `docs/superpowers/plans/2026-10-23-12a-time-scope.md` is committed)_

## Tasks

_(pending)_
