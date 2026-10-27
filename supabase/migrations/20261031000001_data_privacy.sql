-- Plan 16c: Settings -> Data & privacy. Two functions, no table, no change to any existing object.
--
-- 1. data_usage(): what the owner's data occupies, for the "Storage used" card. SECURITY DEFINER because the cover
--    objects (storage.objects, bucket "covers") have no storage policy at all: only a privileged role can see their sizes.
--    It returns nothing unless public.is_owner() (owner + aal2 once 2FA is on). Read-only; no dynamic SQL: the table
--    list is a literal array, sizes come from pg_class / pg_total_relation_size, row counts are the planner's estimate
--    (reltuples; -1 = never analysed -> NULL), never count(*). account_tokens is NOT in the list.
create or replace function public.data_usage()
returns table (kind text, label text, row_count bigint, bytes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    return;
  end if;
  return query
    select 'table'::text, c.relname::text,
           case when c.reltuples < 0 then null else c.reltuples::bigint end,
           pg_catalog.pg_total_relation_size(c.oid)
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname = any (array[
         'accounts', 'account_daily', 'account_daily_breakdown', 'audience_snapshots', 'online_followers',
         'follower_snapshots', 'api_snapshots', 'media', 'media_metrics', 'media_children', 'comments',
         'moderation_settings', 'moderation_rules', 'moderation_log', 'follower_exports', 'tags', 'media_tags',
         'explorer_views', 'notifications', 'push_subscriptions', 'profiles', 'sync_state', 'sync_progress', 'sync_runs'
       ]::text[]);
  return query
    select 'covers'::text, pg_catalog.split_part(o.name, '/', 1), count(*)::bigint,
           coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint
      from storage.objects o
     where o.bucket_id = 'covers'
     group by 2;
  return query
    select 'database'::text, null::text, null::bigint, pg_catalog.pg_database_size(pg_catalog.current_database());
end;
$$;
revoke execute on function public.data_usage() from public, anon;
grant execute on function public.data_usage() to authenticated;

-- 2. delete_all_data(): "Delete all data permanently" (SPEC §7c), the database half, in ONE transaction (all or
--    nothing). security invoker and executable by service_role ONLY: the owner browser session cannot call it through
--    PostgREST, so the server action's password re-check (lib/data/delete.ts, after requireOwner()) is the only way in.
--    Deleting the accounts cascades to account_tokens and every synced or owner-authored per-account row (media,
--    metrics, children, media_tags, comments, follower_exports, moderation_*, snapshots, sync_state, sync_progress,
--    notifications of the account). Then the owner-authored rows without an account: tags, saved views, the remaining
--    notifications, the sync run log. Kept: the login (auth.users, owners, 2FA), profiles (preferences, alert rules)
--    and push_subscriptions (this device's notifications). `where true` because PostgREST sessions load pg-safeupdate,
--    which refuses a DELETE without a WHERE clause. Idempotent: a second call deletes nothing and returns zeros.
--    Cover images (Storage) cannot be deleted in SQL: lib/data/delete.ts removes them with the Storage API afterwards.
create or replace function public.delete_all_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n_accounts bigint;
  n_tags bigint;
  n_views bigint;
begin
  delete from public.accounts where true;
  get diagnostics n_accounts = row_count;
  delete from public.tags where true;
  get diagnostics n_tags = row_count;
  delete from public.explorer_views where true;
  get diagnostics n_views = row_count;
  delete from public.notifications where true;
  delete from public.sync_runs where true;
  return pg_catalog.jsonb_build_object('accounts', n_accounts, 'tags', n_tags, 'views', n_views);
end;
$$;
revoke execute on function public.delete_all_data() from public, anon, authenticated;
grant execute on function public.delete_all_data() to service_role;
