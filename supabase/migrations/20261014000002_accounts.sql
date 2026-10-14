-- Instagram accounts the owner has connected. group_name NULL = isolated account (no group).
create table public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  ig_user_id          text not null unique,
  username            text not null,
  display_name        text,
  account_type        text,
  profile_picture_url text,
  group_name          text check (group_name is null or char_length(group_name) between 1 and 40),
  status              text not null default 'active' check (status in ('active', 'needs_reconnect', 'archived')),
  archived_at         timestamptz,
  last_error          text,
  token_expires_at    timestamptz,                 -- non-secret copy of the token expiry, readable by the owner session
  connected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  check ((status = 'archived') = (archived_at is not null))
);
alter table public.accounts enable row level security;

-- Read-only for the owner session. All writes go through the server-side admin client after an owner check.
create policy accounts_owner_select on public.accounts
  for select to authenticated
  using (public.is_owner());

-- Access tokens: written/read only with the secret (service-role) key, never by a browser session.
create table public.account_tokens (
  account_id   uuid primary key references public.accounts (id) on delete cascade,
  access_token text not null,
  expires_at   timestamptz not null,
  refreshed_at timestamptz not null default now()
);
alter table public.account_tokens enable row level security;

-- Defence in depth: no table privileges for browser roles (service_role is unaffected). The deny-all policy stays
-- so the table still has an explicit policy.
revoke all on public.account_tokens from anon, authenticated;

create policy account_tokens_deny_all on public.account_tokens
  for all to authenticated
  using (false)
  with check (false);
