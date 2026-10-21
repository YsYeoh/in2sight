import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261028000002_follower_exports.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = () => sql.match(/create\s+table\s+public\.follower_exports\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('follower exports migration', () => {
  it('is additive: one table, its index, RLS, three policies and a revoke; no other statement; never account_tokens', () => {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual(['create table', 'create index', 'alter table', 'create policy', 'create policy', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|security\s+definer|grant)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it('one row per snapshot: names and timestamps as parallel arrays, following optional, counts generated', () => {
    const t = table();
    expect(t).toMatch(exact('id uuid primary key default gen_random_uuid()'));
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade')); // "Delete all data permanently" removes them
    expect(t).toMatch(exact("taken_on date not null check (taken_on >= date '2010-10-06')"));
    expect(t).toMatch(exact('followers text[] not null'));
    expect(t).toMatch(exact('followers_at bigint[] not null'));
    expect(t).toMatch(/\bfollowing\s+text\[\]\s*,/i); // nullable: an upload without following.json
    expect(t).toMatch(/\bfollowing_at\s+bigint\[\]\s*,/i);
    expect(t).toMatch(exact('follower_count int generated always as (cardinality(followers)) stored'));
    expect(t).toMatch(exact('following_count int generated always as (cardinality(following)) stored'));
    expect(t).toMatch(exact('created_at timestamptz not null default now()'));
  });

  it('size sanity in the database too: the caps of lib/followers/parse.ts, equal lengths, no null names', () => {
    const t = table();
    expect(t).toMatch(exact('check (cardinality(followers) <= 50000 and cardinality(followers_at) = cardinality(followers) and array_position(followers, null) is null)'));
    expect(t).toMatch(exact('check ((following is null) = (following_at is null))'));
    expect(t).toMatch(exact('check (following is null or (cardinality(following) <= 10000 and cardinality(following_at) = cardinality(following) and array_position(following, null) is null))'));
  });

  it('the name arrays are one-dimensional (a hand-made 2-D array is rejected); an empty array and a null following still pass', () => {
    // array_ndims('{}') is NULL: coalesce(.., 1) makes the empty array pass explicitly, and a null following has no dimension to check
    expect(table()).toMatch(exact('check (coalesce(array_ndims(followers), 1) = 1 and coalesce(array_ndims(following), 1) = 1)'));
  });

  it('owner-authored data: RLS on, select / insert / delete policies for the owner session (is_owner, InitPlan form; nothing updates rows), nothing for anon', () => {
    expect(sql).toMatch(exact('alter table public.follower_exports enable row level security'));
    expect(sql).toMatch(exact('create policy follower_exports_owner_select on public.follower_exports for select to authenticated using ((select public.is_owner()))'));
    expect(sql).toMatch(exact('create policy follower_exports_owner_insert on public.follower_exports for insert to authenticated with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('create policy follower_exports_owner_delete on public.follower_exports for delete to authenticated using ((select public.is_owner()))'));
    expect(sql).not.toMatch(/for\s+(all|update)\b/i);
    expect(sql).not.toMatch(/follower_exports_owner_all/i);
    expect(sql).toMatch(exact('revoke all on public.follower_exports from anon'));
  });

  it('the snapshot list of an account is one index range, newest first', () => {
    expect(sql).toMatch(exact('create index follower_exports_account_idx on public.follower_exports (account_id, taken_on desc, created_at desc)'));
  });
});
