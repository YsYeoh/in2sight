-- Plan 8: alerts (in-app notification centre) and Web Push subscriptions.

-- One row per alert. Written ONLY by the server-side admin client in the sync tick (insert ... on conflict
-- (dedupe_key) do nothing), so an alert never repeats. payload holds i18n parameters only (no prose, no tokens).
create table public.notifications (
  id         bigint generated always as identity primary key,
  account_id uuid references public.accounts (id) on delete cascade,
  kind       text not null check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off')),
  severity   text not null check (severity in ('info', 'warning', 'critical')),
  payload    jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique check (char_length(dedupe_key) <= 200),
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index notifications_created_idx on public.notifications (created_at desc);
create index notifications_unread_idx on public.notifications (created_at desc) where read_at is null;
alter table public.notifications enable row level security;
create policy notifications_owner_select on public.notifications
  for select to authenticated
  using (public.is_owner());
-- mark read: the owner session may update rows, and the column grant below limits that to read_at
create policy notifications_owner_update on public.notifications
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- One row per subscribed browser/device. The owner session subscribes (upsert on endpoint) and unsubscribes
-- (delete by endpoint); the push sender reads them with the admin client and prunes 404/410 endpoints.
create table public.push_subscriptions (
  id         bigint generated always as identity primary key,
  endpoint   text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1024),
  keys       jsonb not null,
  user_agent text check (char_length(user_agent) <= 512),
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_owner_all on public.push_subscriptions
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
