-- Plan 7: post tags (content pillars, SPEC §5). Unlike the sync tables these are owner-authored UI data: the owner
-- session may select/insert/update/delete them under RLS. Server actions use the owner-session client, never the
-- admin client, so RLS applies to every write.

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40 and name = btrim(name)),
  color      text not null default 'chart-1' check (color in ('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6')),
  created_at timestamptz not null default now()
);
-- names are unique ignoring case ("Promo" and "promo" are the same tag); the app normalises first (NFC, spaces)
create unique index tags_name_lower_key on public.tags (lower(name));
alter table public.tags enable row level security;
create policy tags_owner_all on public.tags
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create table public.media_tags (
  media_id   text not null references public.media (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, tag_id)
);
-- the primary key serves lookups by media; this one serves "posts with tag X" and the tag delete cascade
create index media_tags_tag_idx on public.media_tags (tag_id);
alter table public.media_tags enable row level security;
create policy media_tags_owner_all on public.media_tags
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());
