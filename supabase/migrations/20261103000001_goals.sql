-- Plan 17d: goals per account (roadmap §4 Q2 (a)). Three kinds, at most one of each per account:
--   followers      = reach `target` followers by `due_day`
--   avg_reach      = average reach per feed post of the current calendar month (owner timezone)
--   posts_per_week = feed posts in the current week (week-start setting)
-- Progress is computed on read (lib/analysis/goals.ts); nothing here is derived. Owner-authored like tags (owner-all
-- RLS under is_owner()); deleted with the account (cascade), so delete_all_data() (16c) needs no change.

create table public.goals (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  metric     text not null check (metric in ('followers', 'avg_reach', 'posts_per_week')),
  target     integer not null check (target between 1 and 1000000000),
  due_day    date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((metric = 'followers') = (due_day is not null)),
  check (metric <> 'posts_per_week' or target <= 50)
);
-- one goal per (account, metric): the save upserts on it; account_id leads, so it also serves the account delete cascade
create unique index goals_account_metric_key on public.goals (account_id, metric);
alter table public.goals enable row level security;
create policy goals_owner_all on public.goals
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.goals from anon;
