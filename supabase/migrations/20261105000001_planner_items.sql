-- Plan 17f: Planner board (SPEC §7p; creator-toolkit design §0b "planner board only", §6). ONE owner-authored table:
-- post ideas with a status column, an optional planned day/hour (owner timezone) and, once posted, the post they became.
-- Nothing here is ever sent to Instagram: no publishing, no scheduling, no reminders.
-- Owner session under RLS (is_owner(), like tags / explorer_views); never the admin client. The app checks the same
-- limits first (lib/planner/items.ts) and the same media account (app/(app)/plan/planner-actions.ts).
-- account_id cascades, so deleting an account (and "Delete all data", which deletes every account) removes its items:
-- delete_all_data() needs no change. data_usage() (16c) lists tables literally and is not replaced for a table of a few
-- hundred rows (it counts in the database total), as in Plans 17b / 17c. tag_ids is an array (at most 10, no join
-- table): a deleted tag's id stays behind and the board ignores ids it does not know. media_id is set null when the
-- post's row goes; both foreign keys are indexed so the cascades stay linear (the 16c lesson).
create table public.planner_items (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 120 and title = btrim(title)),
  notes        text not null default '' check (char_length(notes) <= 2000),
  status       text not null default 'idea' check (status in ('idea', 'drafting', 'ready', 'posted')),
  format       text check (format in ('REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY')),
  planned_day  date,
  planned_hour smallint check (planned_hour between 0 and 23),
  tag_ids      uuid[] not null default '{}' check (cardinality(tag_ids) <= 10 and coalesce(array_ndims(tag_ids), 1) = 1 and array_position(tag_ids, null) is null),
  media_id     text references public.media (id) on delete set null,
  created_at   timestamptz not null default now(),
  check (planned_hour is null or planned_day is not null),
  check (media_id is null or status = 'posted')
);
create index planner_items_account_idx on public.planner_items (account_id);
create index planner_items_media_idx on public.planner_items (media_id) where media_id is not null;
alter table public.planner_items enable row level security;
create policy planner_items_owner_all on public.planner_items
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.planner_items from anon;
