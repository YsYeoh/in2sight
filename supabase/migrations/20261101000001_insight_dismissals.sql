-- Plan 17b: Insights feed + Today. ONE owner-authored table: the findings the owner dismissed (until = null: for good)
-- or snoozed (until = the time they come back). A finding is computed on read (lib/analysis/insights.ts), never stored;
-- only its key is: `<kind>:<account id>:<id>`, no usernames, no comment text, no captions (the hashtag rule's key holds
-- the owner's own hashtag). Owner session under RLS (is_owner(), like tags / explorer_views); never the admin client.
-- account_id cascades, so deleting an account (and "Delete all data", which deletes every account) removes its rows:
-- delete_all_data() needs no change. The account_id index keeps that cascade linear (the 16c lesson).
create table public.insight_dismissals (
  finding_key text primary key check (char_length(finding_key) between 3 and 200),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  until       timestamptz,
  created_at  timestamptz not null default now()
);
create index insight_dismissals_account_idx on public.insight_dismissals (account_id);
alter table public.insight_dismissals enable row level security;
create policy insight_dismissals_owner_all on public.insight_dismissals
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.insight_dismissals from anon;
