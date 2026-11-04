import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261101000001_insight_dismissals.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = () => sql.match(/create\s+table\s+public\.insight_dismissals\s*\(([\s\S]*?)\n\);/i)?.[1] ?? '';

describe('insight dismissals migration', () => {
  it('is additive: one table, its index, RLS, one policy and a revoke; nothing else', () => {
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual(['create table', 'create index', 'alter table', 'create policy', 'revoke all']);
    expect(sql).not.toMatch(/\b(drop|truncate|security\s+definer|grant|function)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
  });

  it('a key per finding, bound to its account (cascade), an optional until', () => {
    const t = table();
    expect(t).toMatch(exact('finding_key text primary key check (char_length(finding_key) between 3 and 200)'));
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade')); // "Delete all data" deletes every account
    expect(t).toMatch(/\buntil\s+timestamptz\s*,/i); // nullable: null = dismissed for good
    expect(t).toMatch(exact('created_at timestamptz not null default now()'));
    expect(sql).toMatch(exact('create index insight_dismissals_account_idx on public.insight_dismissals (account_id)')); // a linear cascade
  });

  it('owner-authored: RLS on, one for-all policy for authenticated owners (InitPlan form), anon revoked', () => {
    expect(sql).toMatch(exact('alter table public.insight_dismissals enable row level security'));
    expect(sql).toMatch(exact('create policy insight_dismissals_owner_all on public.insight_dismissals for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.insight_dismissals from anon'));
  });
});
