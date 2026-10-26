-- Plan 15d: comment moderation (reply / hide / delete from the app, banned-word and spam auto-hide, undo log).
-- Creator-toolkit design §0b: every action confirmed and logged; hide is reversible (unhide), a reply can be deleted,
-- delete is irreversible on Instagram and never automated.
--
-- Owner-authored settings and rules (like tags): the owner session reads and writes them under RLS; the sync tick
-- (admin client) reads them and sets paused_at. lib/moderation/store.ts is the only app module that names these tables
-- (plus the paused_at read in lib/alerts/store.ts).

create table public.moderation_settings (
  account_id   uuid primary key references public.accounts (id) on delete cascade,
  auto_hide    boolean not null default false,
  paused_at    timestamptz,
  pause_reason text check (pause_reason in ('reconnect', 'failing')),
  updated_at   timestamptz not null default now(),
  check ((paused_at is null) = (pause_reason is null))
);
alter table public.moderation_settings enable row level security;
create policy moderation_settings_owner_all on public.moderation_settings
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.moderation_settings from anon;

-- word = a banned word or phrase (pattern, as typed; matched folded, lib/moderation/rules.ts); the spam kinds have no
-- pattern and exist at most once per account (a row = switched on). The caps match PATTERN_MAX / MAX_WORD_RULES.
create table public.moderation_rules (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind       text not null check (kind in ('word', 'link', 'mentions', 'repeat', 'emoji')),
  pattern    text check (char_length(pattern) between 1 and 50),
  whole_word boolean not null default false,
  created_at timestamptz not null default now(),
  check ((kind = 'word') = (pattern is not null))
);
create index moderation_rules_account_idx on public.moderation_rules (account_id, created_at);
create unique index moderation_rules_spam_once on public.moderation_rules (account_id, kind) where kind <> 'word';
alter table public.moderation_rules enable row level security;
create policy moderation_rules_owner_all on public.moderation_rules
  for all to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
revoke all on public.moderation_rules from anon;

-- One row per action, written BEFORE the Instagram call (result 'pending', request_id from the dialog = the
-- double-submit guard) and finished after it ('ok' or an error key). Ids only: no comment text, no commenter name, no
-- reply text (third-party / personal data). target_id = the reply's id (Undo deletes it). comment_id has no foreign key:
-- the comment may be gone (deleted on Instagram) while its log row stays. Append-only for the app: no delete grant;
-- rows go with the account (cascade). Owner inserts must be actor 'owner'; rule rows come from the tick (admin client).
-- The owner session may INSERT only the columns lib/moderation/store.ts insertLog sends (never result, created_at or
-- undone_at), and may UPDATE only result + target_id (finishLog: a 'pending' row gets its outcome, a reply its id) and
-- undone_at (markUndone: once), and only on rows that are still pending or not yet undone: an undone row is frozen.
-- Residual (a column grant cannot look at the old value): a finished row that is not undone yet could still have its
-- result rewritten by the owner session; the tick's admin client is not bound by any of this.
create table public.moderation_log (
  id         bigint generated always as identity primary key,
  account_id uuid not null references public.accounts (id) on delete cascade,
  comment_id text not null check (comment_id ~ '^\w{1,64}$'),
  action     text not null check (action in ('reply', 'hide', 'unhide', 'delete', 'delete_reply')),
  actor      text not null check (actor = 'owner' or actor ~ '^rule:[0-9a-f-]{36}$'),
  request_id uuid not null unique,
  result     text not null default 'pending' check (result ~ '^[a-z_]{1,40}$'),
  target_id  text check (target_id ~ '^\w{1,64}$'),
  undo_of    bigint references public.moderation_log (id) on delete set null,
  created_at timestamptz not null default now(),
  undone_at  timestamptz
);
-- the log page (newest first) and "was this comment touched?" (auto-hide)
create index moderation_log_account_idx on public.moderation_log (account_id, created_at desc);
create index moderation_log_comment_idx on public.moderation_log (account_id, comment_id);
alter table public.moderation_log enable row level security;
create policy moderation_log_owner_select on public.moderation_log
  for select to authenticated
  using ((select public.is_owner()));
create policy moderation_log_owner_insert on public.moderation_log
  for insert to authenticated
  with check ((select public.is_owner()) and actor = 'owner');
create policy moderation_log_owner_update on public.moderation_log
  for update to authenticated
  using ((select public.is_owner()) and (result = 'pending' or undone_at is null))
  with check ((select public.is_owner()));
revoke all on public.moderation_log from anon, authenticated;
grant select on public.moderation_log to authenticated;
grant insert (account_id, comment_id, action, actor, request_id, undo_of, target_id) on public.moderation_log to authenticated;
grant update (result, target_id, undone_at) on public.moderation_log to authenticated;

-- comments (Plan 11b: owner select only): after a hide/unhide the owner session sets hidden; after a delete on
-- Instagram (a confirmed DELETE, never an error answer) it removes the row. Nothing else becomes writable.
create policy comments_owner_update on public.comments
  for update to authenticated
  using ((select public.is_owner()))
  with check ((select public.is_owner()));
create policy comments_owner_delete on public.comments
  for delete to authenticated
  using ((select public.is_owner()));
grant update (hidden) on public.comments to authenticated;
grant delete on public.comments to authenticated;

-- One notification per auto-hide pause (lib/alerts/rules.ts, dedupe key moderation_paused:<account>:<paused_at>).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused'));
