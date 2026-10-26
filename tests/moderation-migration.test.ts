import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261029000002_comment_moderation.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
const table = (name: string) => sql.match(new RegExp(`create\\s+table\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] ?? '';

describe('comment moderation migration', () => {
  it('is additive: three tables, no drop except the one notifications check it re-creates, never account_tokens', () => {
    expect(sql.match(/create\s+table/gi)).toHaveLength(3);
    expect(sql.match(/\bdrop\b/gi)).toHaveLength(1);
    expect(sql).toMatch(exact('alter table public.notifications drop constraint notifications_kind_check'));
    expect(sql).not.toMatch(/\b(truncate|security\s+definer)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it('settings: one row per account, off by default, a pause always has a reason', () => {
    const t = table('moderation_settings');
    expect(t).toMatch(exact('account_id uuid primary key references public.accounts (id) on delete cascade'));
    expect(t).toMatch(exact('auto_hide boolean not null default false'));
    expect(t).toMatch(exact("pause_reason text check (pause_reason in ('reconnect', 'failing'))"));
    expect(t).toMatch(exact('check ((paused_at is null) = (pause_reason is null))'));
  });

  it('rules: words with a pattern, spam kinds without, each spam kind at most once per account', () => {
    const t = table('moderation_rules');
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade'));
    expect(t).toMatch(exact("kind text not null check (kind in ('word', 'link', 'mentions', 'repeat', 'emoji'))"));
    expect(t).toMatch(exact('pattern text check (char_length(pattern) between 1 and 50)'));
    expect(t).toMatch(exact("check ((kind = 'word') = (pattern is not null))"));
    expect(sql).toMatch(exact("create unique index moderation_rules_spam_once on public.moderation_rules (account_id, kind) where kind <> 'word'"));
  });

  it('log: ids only (no comment text, no author, no reply text), constrained actions and actors, unique request id', () => {
    const t = table('moderation_log');
    expect(t).not.toMatch(/\b(text|author|username|message)\b\s+text/i);
    expect(t).toMatch(exact('account_id uuid not null references public.accounts (id) on delete cascade'));
    expect(t).toMatch(exact("action text not null check (action in ('reply', 'hide', 'unhide', 'delete', 'delete_reply'))"));
    expect(t).toMatch(exact("actor text not null check (actor = 'owner' or actor ~ '^rule:[0-9a-f-]{36}$')"));
    expect(t).toMatch(exact('request_id uuid not null unique'));
    expect(t).toMatch(exact("result text not null default 'pending' check (result ~ '^[a-z_]{1,40}$')"));
    expect(t).toMatch(exact('undo_of bigint references public.moderation_log (id) on delete set null'));
    expect(sql).toMatch(exact('create index moderation_log_account_idx on public.moderation_log (account_id, created_at desc)'));
    expect(sql).toMatch(exact('create index moderation_log_comment_idx on public.moderation_log (account_id, comment_id)'));
  });

  it('owner-authored settings and rules: RLS, one policy for the owner (InitPlan form), nothing for anon', () => {
    for (const t of ['moderation_settings', 'moderation_rules']) {
      expect(sql).toMatch(exact(`alter table public.${t} enable row level security`));
      expect(sql).toMatch(exact(`create policy ${t}_owner_all on public.${t} for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))`));
      expect(sql).toMatch(exact(`revoke all on public.${t} from anon`));
    }
  });

  it('log is append-only for the owner: select + insert (as owner only) + update of three columns, no delete', () => {
    expect(sql).toMatch(exact('alter table public.moderation_log enable row level security'));
    expect(sql).toMatch(exact('create policy moderation_log_owner_select on public.moderation_log for select to authenticated using ((select public.is_owner()))'));
    expect(sql).toMatch(exact("create policy moderation_log_owner_insert on public.moderation_log for insert to authenticated with check ((select public.is_owner()) and actor = 'owner')"));
    expect(sql).toMatch(exact('create policy moderation_log_owner_update on public.moderation_log for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('revoke all on public.moderation_log from anon, authenticated'));
    expect(sql).toMatch(exact('grant select, insert on public.moderation_log to authenticated'));
    expect(sql).toMatch(exact('grant update (result, target_id, undone_at) on public.moderation_log to authenticated'));
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*moderation_log/i);
  });

  it('comments: the owner may flip hidden and remove a deleted comment, nothing else', () => {
    expect(sql).toMatch(exact('create policy comments_owner_update on public.comments for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))'));
    expect(sql).toMatch(exact('create policy comments_owner_delete on public.comments for delete to authenticated using ((select public.is_owner()))'));
    expect(sql).toMatch(exact('grant update (hidden) on public.comments to authenticated'));
    expect(sql).toMatch(exact('grant delete on public.comments to authenticated'));
    expect(sql).not.toMatch(/grant\s+(insert|update\s+on|all)[^;]*public\.comments/i);
  });

  it('notifications accept the new kind next to the five existing ones', () => {
    expect(sql).toMatch(exact("alter table public.notifications add constraint notifications_kind_check check (kind in ('token_expiring', 'needs_reconnect', 'sync_failing', 'reach_drop', 'taking_off', 'moderation_paused'))"));
  });
});
