import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261029000001_comment_insights.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = {
  comment_list: 'uuid, timestamptz, timestamptz, text, text, text, boolean, int, text, int, int',
  comment_fans: 'uuid, text, text, timestamptz, int, int, int, int, int, int',
  comment_outsiders: 'uuid, text, int, int',
};
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
/** The statements outside function bodies. */
const statements = sql.replace(/\$\$[\s\S]*?\$\$/g, 'BODY').split(';').map((s) => s.trim()).filter(Boolean);

describe('comment insights migration', () => {
  it('is additive: one policy rewrite, three functions, their revokes and grants; nothing else; never account_tokens', () => {
    expect(statements.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toLowerCase())).toEqual([
      'alter policy', 'create or', 'create or', 'create or', 'revoke execute', 'revoke execute', 'revoke execute', 'grant execute', 'grant execute', 'grant execute',
    ]);
    expect(sql).not.toMatch(/\b(drop|truncate|create\s+table|create\s+index|create\s+policy|security\s+definer)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect(sql).not.toMatch(/^\s*(insert|update|delete)\b/im);
  });

  it('the comments policy reads is_owner() once per query (InitPlan form)', () => {
    expect(sql).toMatch(exact('alter policy comments_owner_select on public.comments using ((select public.is_owner()))'));
  });

  it.each(Object.keys(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL, one account, a capped page with the total', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const [, head, body] = m!;
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\blike\b|\bilike\b/i); // nothing spliced into SQL text; no LIKE patterns
    expect(body).toMatch(exact('where c.account_id = p_account'));
    expect(body).toMatch(/count\(\*\)\s+over\s+\(\)\s+as\s+total/i);
    expect(body).toMatch(exact('where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200)'));
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('comment_list: window, post, search without patterns, the question pattern as a parameter, fans, newest first', () => {
    const body = fn('comment_list')![2];
    expect(body).toMatch(exact('and c.commented_at >= p_from and c.commented_at < p_to'));
    expect(body).toMatch(exact('and (p_media is null or c.media_id = p_media)'));
    expect(body).toMatch(exact("and (p_q is null or strpos(lower(coalesce(c.text, '')), lower(p_q)) > 0 or strpos(lower(coalesce(c.author_username, '')), lower(p_q)) > 0)"));
    expect(body).toMatch(exact("and (p_question_re is null or coalesce(c.text, '') ~* p_question_re)"));
    expect(body).toMatch(exact('group by 1 having count(*) >= p_fan_min'));
    expect(body).toMatch(exact('row_number() over (order by f.commented_at desc, f.id desc) as n'));
  });

  it('comment_list: "replied" = a LATER top-level comment by the owner on the same post that @mentions the author; unanswered leaves the owner out', () => {
    const body = fn('comment_list')![2];
    expect(body).toMatch(
      exact(`exists (
             select 1 from public.comments o
              where o.media_id = c.media_id
                and lower(o.author_username) = lower(p_owner)
                and o.commented_at > c.commented_at
                and strpos(lower(coalesce(o.text, '')), '@' || lower(c.author_username)) > 0
           ) as replied`),
    );
    expect(body).toMatch(exact('where p_unanswered is not true or (not f.replied and f.author_username is not null and lower(f.author_username) <> lower(p_owner))'));
    expect(body).toMatch(exact('left join public.media m on m.id = r.media_id'));
  });

  it('comment_fans: by lower-cased name without the owner; the three modes with the parameters; quiet counts feed posts since', () => {
    const body = fn('comment_fans')![2];
    expect(body).toMatch(exact('select lower(c.author_username) as username, count(*) as comments, coalesce(sum(c.like_count), 0)::bigint as likes'));
    expect(body).toMatch(exact('and c.author_username is not null and lower(c.author_username) <> lower(p_owner)'));
    expect(body).toMatch(exact("or (p_mode = 'new' and b.first_at >= p_now - p_days * interval '1 day' and b.comments >= p_new_min)"));
    expect(body).toMatch(exact("or (p_mode = 'quiet' and b.comments >= p_fan_min and b.last_at < p_now - p_days * interval '1 day' and b.posts_since >= p_quiet_posts)"));
    expect(body).toMatch(exact("where m.account_id = p_account and m.media_type <> 'STORY' and m.posted_at > a.last_at and m.posted_at <= p_now"));
    expect(body).toMatch(exact("order by case when p_mode = 'new' then f.first_at end desc, f.comments desc, f.likes desc, f.last_at desc, f.username"));
  });

  it('comment_outsiders: the NEWEST follower export of this account only; anti-join on the unnested names; nothing without an export', () => {
    const body = fn('comment_outsiders')![2];
    expect(body).toMatch(exact('from public.follower_exports e where e.account_id = p_account order by e.taken_on desc, e.created_at desc limit 1'));
    expect(body).toMatch(exact('select unnest(s.followers) as u from s'));
    expect(body).toMatch(exact('where exists (select 1 from s) and not exists (select 1 from f where f.u = a.username)'));
    expect(body).toMatch(exact('row_number() over (order by o.comments desc, o.last_at desc, o.username) as n'));
  });
});
