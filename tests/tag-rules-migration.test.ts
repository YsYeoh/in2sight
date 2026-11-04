import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261102000001_tag_rules.sql'), 'utf8').replace(/--.*$/gm, '');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');

describe('tag rules migration (Plan 17c)', () => {
  it('two owner-only tables, one column, one trigger; nothing dropped, no grant, no definer', () => {
    const heads = sql
      .replace(/\$\$[\s\S]*?\$\$/g, '$$body$$')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase());
    expect(heads).toEqual(['create table', 'create unique', 'alter table', 'create policy', 'revoke all', 'alter table', 'create table', 'create index', 'alter table', 'create policy', 'revoke all', 'create or', 'create trigger']);
    expect(sql).not.toMatch(/\b(drop|truncate|grant|security\s+definer)\b/i);
  });

  it('tag_rules: kinds, formats and length; cascades with the tag; unique per tag, kind and value ignoring case', () => {
    expect(sql).toMatch(exact("kind text not null check (kind in ('hashtag', 'word', 'format'))"));
    expect(sql).toMatch(exact('char_length(value) between 1 and 50 and value = btrim(value)'));
    expect(sql).toMatch(exact("check (kind <> 'format' or value in ('IMAGE', 'CAROUSEL_ALBUM', 'REELS'))"));
    expect(sql).toMatch(exact('tag_id uuid not null references public.tags (id) on delete cascade'));
    expect(sql).toMatch(exact('create unique index tag_rules_tag_kind_value_key on public.tag_rules (tag_id, kind, lower(value))'));
  });

  it('media_tags.source: manual by default (every existing row), auto only from rules', () => {
    expect(sql).toMatch(exact("alter table public.media_tags add column source text not null default 'manual' check (source in ('manual', 'auto'))"));
  });

  it('media_tag_rejections: one row per (post, tag), deleted with the post or the tag', () => {
    expect(sql).toMatch(exact('media_id text not null references public.media (id) on delete cascade'));
    expect(sql).toMatch(exact('primary key (media_id, tag_id)'));
    expect(sql).toMatch(exact('create index media_tag_rejections_tag_idx on public.media_tag_rejections (tag_id)'));
  });

  it('RLS on both tables, owner-all in InitPlan form, authenticated only, anon revoked', () => {
    for (const t of ['tag_rules', 'media_tag_rejections']) {
      expect(sql).toMatch(exact(`revoke all on public.${t} from anon`));
      expect(sql).toMatch(exact(`alter table public.${t} enable row level security`));
      expect(sql).toMatch(exact(`create policy ${t}_owner_all on public.${t} for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))`));
    }
  });

  it('the trigger skips only rule-written rows of a removed pair, as invoker with a pinned search_path', () => {
    const fn = sql.match(/create or replace function public\.media_tags_skip_rejected\(\)[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(fn).toMatch(exact('security invoker'));
    expect(fn).toMatch(exact("set search_path = ''"));
    expect(fn).toMatch(exact("if new.source = 'auto' and exists (select 1 from public.media_tag_rejections r where r.media_id = new.media_id and r.tag_id = new.tag_id) then return null;"));
    expect(sql).toMatch(exact('create trigger media_tags_skip_rejected before insert on public.media_tags for each row execute function public.media_tags_skip_rejected()'));
  });
});
