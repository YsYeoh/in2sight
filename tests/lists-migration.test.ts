import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// comments stripped so the assertions see only SQL
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261027000001_post_story_lists.sql'), 'utf8').replace(/--.*$/gm, '');
const fn = (name: string) => sql.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
const FUNCTIONS = { post_list: 'uuid, timestamptz, timestamptz, text, text, uuid, boolean, text, boolean, int, int', story_list: 'uuid, timestamptz, timestamptz, text, boolean, text, int, int' };
const esc = (s: string) => s.replace(/[[\]()]/g, '\\$&').replace(/,\s*/g, ',\\s*');
/** The given SQL exactly, with any whitespace between tokens. */
const exact = (s: string) => new RegExp(s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');

describe('post/story list migration', () => {
  it('is additive: two functions, no tables, indexes, policies or column changes, never account_tokens', () => {
    expect(sql).not.toMatch(/\b(drop|alter|create\s+table|create\s+index|create\s+policy|insert|update|delete)\b/i);
    expect(sql).not.toMatch(/account_tokens/i);
    expect([...sql.matchAll(/create\s+or\s+replace\s+function/gi)]).toHaveLength(2);
  });

  it.each(Object.keys(FUNCTIONS))('%s: security invoker, stable, pinned search_path, no dynamic SQL, one account and one window', (name) => {
    const m = fn(name);
    expect(m, name).not.toBeNull();
    const [, head, body] = m!;
    expect(head).toMatch(/language\s+sql/i);
    expect(head).toMatch(/\bstable\b/i);
    expect(head).toMatch(/security\s+invoker/i);
    expect(head).not.toMatch(/security\s+definer/i);
    expect(head).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(body).not.toMatch(/\bexecute\b|format\s*\(|quote_ident|\|\||\blike\b/i); // nothing spliced into SQL text; no LIKE patterns
    expect(body).toMatch(exact('where m.account_id = p_account'));
    expect(body).toMatch(exact('and m.posted_at >= p_from and m.posted_at < p_to'));
    expect(body).toMatch(/count\(\*\)\s+over\s+\(\)/i); // the total rides on every row
  });

  it.each(Object.entries(FUNCTIONS))('%s: execute revoked from public and anon, granted to authenticated only', (name, args) => {
    expect(sql).toMatch(new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+from\\s+public\\s*,\\s*anon\\s*;`, 'i'));
    expect(sql).toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}\\(${esc(args)}\\)\\s+to\\s+authenticated\\s*;`, 'i'));
    expect(sql).not.toMatch(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[^;]*\\bto\\s+[^;]*\\b(anon|public)\\b`, 'i'));
  });

  it('post_list: feed posts only, the LATEST snapshot, search in caption or tag names without patterns, format/tag/untagged', () => {
    const body = fn('post_list')![2];
    expect(body).toMatch(exact("and m.media_type <> 'STORY'"));
    expect(body).toMatch(exact('where x.media_id = m.id order by x.captured_at desc limit 1')); // as loadPostRows / the tab
    expect(body).toMatch(exact("strpos(lower(coalesce(m.caption, '')), lower(p_q)) > 0"));
    expect(body).toMatch(exact('join public.tags g on g.id = t.tag_id where t.media_id = m.id and strpos(lower(g.name), lower(p_q)) > 0'));
    expect(body).toMatch(exact('(p_format is null or m.media_type = p_format)'));
    expect(body).toMatch(exact('(p_tag is null or exists (select 1 from public.media_tags t where t.media_id = m.id and t.tag_id = p_tag))'));
    expect(body).toMatch(exact('(p_untagged is not true or not exists (select 1 from public.media_tags t where t.media_id = m.id))'));
  });

  it('post_list: the engagement sort key is engagementRate (lib/analysis/posts.ts); nulls last both ways; ties newest first; the page', () => {
    const body = fn('post_list')![2];
    expect(body).toMatch(
      exact(`case when s.reach > 0 and num_nonnulls(s.likes, s.comments, s.saves, s.shares) > 0
             then (coalesce(s.likes, 0) + coalesce(s.comments, 0) + coalesce(s.saves, 0) + coalesce(s.shares, 0))::numeric / s.reach
        end as er`),
    );
    for (const [key, col] of [['reach', 'reach'], ['views', 'views'], ['engagement', 'er']]) {
      expect(body, key).toMatch(exact(`case when p_sort = '${key}' and p_asc is not true then f.${col} end desc nulls last`));
      expect(body, key).toMatch(exact(`case when p_sort = '${key}' and p_asc then f.${col} end asc nulls last`));
    }
    expect(body).toMatch(exact("case when p_sort = 'date' and p_asc then f.posted_at end asc, case when p_sort = 'date' and p_asc then f.id end asc, f.posted_at desc, f.id desc) as n"));
    expect(body).toMatch(exact('where r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200) order by r.n'));
    expect(body).toMatch(exact('array(select t.tag_id from public.media_tags t where t.media_id = r.id order by t.tag_id)')); // tags for the page only
  });

  it('story_list: Stories only; FINAL numbers = newest snapshot before expiry, else the newest (buildStories); exit rate; measured', () => {
    const body = fn('story_list')![2];
    expect(body).toMatch(exact("and m.media_type = 'STORY'"));
    expect(body).toMatch(exact("where x.media_id = m.id and x.captured_at <= coalesce(m.expires_at, m.posted_at + interval '1 day') order by x.captured_at desc limit 1)"));
    expect(body).toMatch(exact('where x.media_id = m.id order by x.captured_at desc limit 1)) u order by u.k limit 1'));
    expect(body).toMatch(exact('case when s.exits is not null and s.views > 0 then s.exits::numeric / s.views end as exit_rate'));
    expect(body).toMatch(exact('(p_measured is null or (s.captured_at is not null) = p_measured)'));
  });

  it('story_list: owner-timezone days, newest pages by whole days, other sorts by Story; nulls last, ties newest first; series for the page only', () => {
    const body = fn('story_list')![2];
    expect(body).toMatch(exact('(m.posted_at at time zone p_tz)::date as day'));
    expect(body).toMatch(exact('dense_rank() over (order by f.day desc) as day_n'));
    expect(body).toMatch(exact("case when p_sort = 'views' then f.views end desc nulls last, case when p_sort = 'exit' then f.exit_rate end desc nulls last, f.posted_at desc, f.id desc) as n"));
    expect(body).toMatch(exact("where case when p_sort = 'newest' then r.day_n > p_offset and r.day_n <= p_offset::bigint + least(greatest(p_limit, 0), 200) else r.n > p_offset and r.n <= p_offset::bigint + least(greatest(p_limit, 0), 200) end"));
    expect(body).toMatch(exact('(select coalesce(max(r2.day_n), 0) from r r2) as days'));
    const [, after] = body.split(/\)\s+select\s+p\.id/i); // the final select, after the page was cut
    expect(after).toMatch(exact('array_agg(x.views order by x.captured_at) as progression'));
    expect(body.split(/\)\s+select\s+p\.id/i)[0]).not.toMatch(/array_agg/i);
  });
});
