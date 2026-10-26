# Owner actions — everything still to do by hand

> **Newest (2026-10-23):** the ordered list of live checks for Plans 11b to 15b is in [PROGRESS.md §6](PROGRESS.md) (tabs, then Growth, then Followers with a real export, then the rest). Tick items here as you go.

One checklist for the whole project. Claude cannot do these (they need your logins, phone or browser). Tick them off
here as you go. **No secrets belong in this file** (no passwords, tokens, keys, comment texts, CDN links): write only
"done" and a date.

## Plan 11b — capture extras (docs/RUNBOOK_CAPTURE.md)
- [x] Apply the migration `supabase/migrations/20261022000001_capture_v2b.sql` BEFORE the new code is deployed
      ([RUNBOOK_CAPTURE §0](RUNBOOK_CAPTURE.md), command in [HANDOVER §4](HANDOVER.md)). Done; the new tables and
      columns were confirmed present on the live project on 2026-10-17.
- [ ] Reconnect each Instagram account once to grant comments: `/accounts` -> "Reconnect to enable comments"
      ([RUNBOOK_CAPTURE §1](RUNBOOK_CAPTURE.md)). Until you do, comments are not read for that account.
- [ ] Post a Story (>= 5 viewers) and run the probe, then record supported / unsupported in
      [META_PROBE_RESULTS.md](META_PROBE_RESULTS.md) ([RUNBOOK_CAPTURE §3](RUNBOOK_CAPTURE.md)).
- [ ] Run the SQL checks for extras, media fields, covers, comments and the archive
      ([RUNBOOK_CAPTURE §4-§8](RUNBOOK_CAPTURE.md)); tell Claude anything that looks wrong.

## Accounts and login
- [ ] Change the password that was typed in chat (Supabase dashboard -> Authentication -> Users, or your sign-in flow).
- [ ] Supabase Auth -> URL configuration: set **Site URL** to the real domain (see [SETUP_SUPABASE.md](SETUP_SUPABASE.md)).
- [ ] Supabase Auth for password reset (forgot / reset is built, Plan 16b; it cannot work before this): [RUNBOOK_SECURITY §0](RUNBOOK_SECURITY.md) (custom SMTP, Reset Password template, Site URL https://in2sight.yongsen.space, password minimum 12, email limit 10 per hour, sign-ups off). Then the live checks in RUNBOOK_SECURITY §1–§6.
- [ ] Meta deauthorize callback: check it flags an account; if not, report what id Meta sent
      ([RUNBOOK_META.md](RUNBOOK_META.md)).

## Visual and real-device checks (nothing below has been looked at in a browser yet)
- [ ] Dashboards at 360 / 768 / 1280 px, light and dark: [RUNBOOK_DASHBOARDS.md](RUNBOOK_DASHBOARDS.md)
- [ ] Alerts: enable push on desktop and on your phone, install the PWA: [RUNBOOK_ALERTS.md](RUNBOOK_ALERTS.md)
- [ ] Exports: Excel opens correctly; **PDF on real Chromium** (Chinese glyphs, chart width, timing):
      [RUNBOOK_EXPORTS.md](RUNBOOK_EXPORTS.md)
- [ ] Speed: click -> feedback, Server-Timing, fill the before/after table: [RUNBOOK_PERF.md](RUNBOOK_PERF.md)
- [ ] Onboarding sync on a fresh account (reload mid-import, badge, 360/768/1280): [RUNBOOK_SYNC.md](RUNBOOK_SYNC.md) §8
- [ ] Optional: record real fixtures with `npm run record:fixtures` ([RUNBOOK_SYNC.md](RUNBOOK_SYNC.md) §4).

## SPEC edits made by Plan 11b — flagged for your approval
`docs/SPEC.md` is the source of truth, so these Plan 11b edits are yours to approve or reject (the code already matches them):
- [ ] §5 `accounts`: new column `granted_scopes`.
- [ ] §5 `media`: media fields (`media_product_type`, `like_count`, `comments_count`, `is_shared_to_feed`, `children_count`), cover columns, `comments_synced_count`.
- [ ] §5 new tables `media_children`, `comments`, `api_snapshots`; `media_metrics` extras columns.
- [ ] §5 `sync_state`: new column `capabilities`.
- [ ] §6 new paragraph "Capture extras (Plan 11b)" (separate non-fatal calls, capability memory, lane-2 covers and comments, raw archive).
