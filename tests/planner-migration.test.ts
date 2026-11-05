import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261105000001_planner_items.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = () => sql.match(/create\s+table\s+public\.planner_items\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('planner_items migration', () => {
  it('is additive: one table, two indexes, RLS, one policy and a revoke; no function is touched', () => {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual(['create table', 'create index', 'create index', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|security\s+definer|grant|function)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });

  it('bound to its account (cascade), linked post set null, both foreign keys indexed', () => {
    const t = table();
    expect(t).toMatch(exact('id uuid primary key default gen_random_uuid()'));
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade')); // "Delete all data" deletes every account
    expect(t).toMatch(exact('media_id text references public.media (id) on delete set null'));
    expect(sql).toMatch(exact('create index planner_items_account_idx on public.planner_items (account_id)'));
    expect(sql).toMatch(exact('create index planner_items_media_idx on public.planner_items (media_id) where media_id is not null'));
  });

  it('the checks (the same limits as lib/planner/items.ts; tests/planner-actions.test.ts pins that)', () => {
    const t = table();
    expect(t).toMatch(exact('check (char_length(title) between 1 and 120 and title = btrim(title))'));
    expect(t).toMatch(exact("notes text not null default '' check (char_length(notes) <= 2000)"));
    expect(t).toMatch(exact("status text not null default 'idea' check (status in ('idea', 'drafting', 'ready', 'posted'))"));
    expect(t).toMatch(exact("format text check (format in ('REELS', 'CAROUSEL_ALBUM', 'IMAGE', 'STORY'))"));
    expect(t).toMatch(exact('planned_day date,'));
    expect(t).toMatch(exact('planned_hour smallint check (planned_hour between 0 and 23)'));
    expect(t).toMatch(exact("tag_ids uuid[] not null default '{}' check (cardinality(tag_ids) <= 10 and coalesce(array_ndims(tag_ids), 1) = 1 and array_position(tag_ids, null) is null)"));
    expect(t).toMatch(exact('check (planned_hour is null or planned_day is not null)'));
    expect(t).toMatch(exact("check (media_id is null or status = 'posted')"));
  });

  it('owner-authored: RLS on, one for-all policy for authenticated owners (InitPlan form), anon revoked', () => {
    expect(sql).toMatch(exact('alter table public.planner_items enable row level security'));
    expect(sql).toMatch(exact('create policy planner_items_owner_all on public.planner_items for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.planner_items from anon'));
  });
});
