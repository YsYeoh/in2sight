import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261103000001_goals.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');

describe('goals migration (Plan 17d)', () => {
  it('one owner-only table and its index; nothing dropped, no function, no grant', () => {
    const heads = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    expect(heads).toEqual(['create table', 'create unique', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|grant|function|security\s+definer)\b/i);
  });

  it('metrics, target range and due day (tests/plan-model.test.ts pins lib/analysis/goals.ts to these literals)', () => {
    expect(sql).toMatch(exact("metric text not null check (metric in ('followers', 'avg_reach', 'posts_per_week'))"));
    expect(sql).toMatch(exact('target integer not null check (target between 1 and 1000000000)'));
    expect(sql).toMatch(exact("check (metric <> 'posts_per_week' or target <= 50)"));
    expect(sql).toMatch(exact("check ((metric = 'followers') = (due_day is not null))"));
  });

  it('cascades with the account; one goal per account and metric', () => {
    expect(sql).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade'));
    expect(sql).toMatch(exact('create unique index goals_account_metric_key on public.goals (account_id, metric)'));
  });

  it('RLS on, owner-all in InitPlan form, authenticated only, anon revoked', () => {
    expect(sql).toMatch(exact('alter table public.goals enable row level security'));
    expect(sql).toMatch(exact('create policy goals_owner_all on public.goals for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.goals from anon'));
  });
});
