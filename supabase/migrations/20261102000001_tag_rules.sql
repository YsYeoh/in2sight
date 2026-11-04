-- Plan 17c: auto-tagging. Owner-authored rules ("hashtag is #x", "caption contains word", "format is Reels") add a tag
-- to posts by themselves; the owner only corrects. Matching runs in TypeScript (lib/tag-rules/rules.ts: Unicode/CJK-safe),
-- not here. Three hard rules, two of them enforced by the database itself:
--  1. a tag on a post is never overwritten: rules only INSERT ... ON CONFLICT DO NOTHING into media_tags;
--  2. a tag the owner removed from a post is never added back by a rule: media_tag_rejections + the trigger below;
--  3. rules never delete anything (deleting a rule keeps the tags it added).
-- Owner-authored like tags (owner-all RLS); the sync writes media_tags with the service role (bypasses RLS).

create table public.tag_rules (
  id         uuid primary key default gen_random_uuid(),
  tag_id     uuid not null references public.tags (id) on delete cascade,
  kind       text not null check (kind in ('hashtag', 'word', 'format')),
  value      text not null check (char_length(value) between 1 and 50 and value = btrim(value)),
  created_at timestamptz not null default now(),
  check (kind <> 'format' or value in ('IMAGE', 'CAROUSEL_ALBUM', 'REELS'))
);
-- one rule per (tag, kind, value) ignoring case; it also serves the tag delete cascade (tag_id leads)
create unique index tag_rules_tag_kind_value_key on public.tag_rules (tag_id, kind, lower(value));
alter table public.tag_rules enable row level security;
create policy tag_rules_owner_all on public.tag_rules
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.tag_rules from anon;

-- who put the tag on the post: the owner (default, every row that exists today) or a rule
alter table public.media_tags add column source text not null default 'manual' check (source in ('manual', 'auto'));

-- (post, tag) pairs the owner removed by hand: a rule never adds them again
create table public.media_tag_rejections (
  media_id   text not null references public.media (id) on delete cascade,
  tag_id     uuid not null references public.tags (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (media_id, tag_id)
);
-- the primary key serves lookups by post; this one the tag delete cascade
create index media_tag_rejections_tag_idx on public.media_tag_rejections (tag_id);
alter table public.media_tag_rejections enable row level security;
create policy media_tag_rejections_owner_all on public.media_tag_rejections
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.media_tag_rejections from anon;

-- Belt and braces for rule 2: even a rule run that read the rejections a moment before the owner removed the tag cannot
-- add it back. Only rows written by a rule (source 'auto') are skipped; the owner can always tag a post by hand again.
create or replace function public.media_tags_skip_rejected()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source = 'auto' and exists (select 1 from public.media_tag_rejections r where r.media_id = new.media_id and r.tag_id = new.tag_id) then
    return null;
  end if;
  return new;
end;
$$;
create trigger media_tags_skip_rejected
  before insert on public.media_tags
  for each row execute function public.media_tags_skip_rejected();
