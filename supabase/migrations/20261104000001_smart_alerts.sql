-- Plan 17e: smart alerts (SPEC §7c). Four new notification kinds; nothing else changes. Quiet hours and the summary
-- switches live in profiles.alert_settings (jsonb, parsed by lib/alerts/settings.ts), so they need no column. The two
-- summaries reuse the unique dedupe_key ('digest:<day>', 'weekly_digest:<day>'): a retried or overlapping tick can never
-- store or push one twice. No new table, policy or grant: notifications keeps its RLS (owner select, read_at update).
-- The kind list must equal ALERT_KINDS in lib/alerts/settings.ts (tests/alert-settings.test.ts).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused', 'nonfollower_spike', 'unfollow_spike', 'digest', 'weekly_digest'));
