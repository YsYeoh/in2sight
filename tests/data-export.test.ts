// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { afterFilter, EXPORT_TABLES, exportPages, findExportTable, jsonArrayStream, PAGE_ROWS, quoteValue, type Row } from '@/lib/data/export';

/** A fake owner-session client: answers the queued pages in order and records every query it was asked. */
function fakeDb(pages: (Row[] | { error: true })[]) {
  const calls: { table: string; select: string; order: string[]; or: string | null; limit: number }[] = [];
  const db = {
    from(table: string) {
      const call = { table, select: '', order: [] as string[], or: null as string | null, limit: 0 };
      calls.push(call);
      const q = {
        select(s: string) {
          call.select = s;
          return q;
        },
        order(k: string, o: { ascending: boolean }) {
          call.order.push(`${k}:${o.ascending ? 'asc' : 'desc'}`);
          return q;
        },
        or(f: string) {
          call.or = f;
          return q;
        },
        async limit(n: number) {
          call.limit = n;
          const next = pages.shift() ?? [];
          return 'error' in next ? { data: null, error: { message: 'secret value 123' } } : { data: next, error: null };
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

const collect = async (it: AsyncIterable<Row[]>) => {
  const out: Row[][] = [];
  for await (const p of it) out.push(p);
  return out;
};

describe('export registry', () => {
  it('never lists the token, push or bookkeeping tables', () => {
    const names = EXPORT_TABLES.map((t) => t.name);
    for (const n of ['account_tokens', 'push_subscriptions', 'owners', 'sync_state', 'sync_progress', 'sync_runs']) expect(names).not.toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it('marks exactly the tables with other people’s personal data', () => {
    expect(EXPORT_TABLES.filter((t) => 'thirdParty' in t && t.thirdParty).map((t) => t.name)).toEqual(['comments', 'follower_exports']);
  });

  it('each table’s keys are its primary key as written in the migrations', () => {
    const sql = readdirSync(join(process.cwd(), 'supabase/migrations'))
      .sort()
      .map((f) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8'))
      .join('\n');
    for (const t of EXPORT_TABLES) {
      const body = sql.match(new RegExp(`create table public\\.${t.name} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '';
      expect(body, t.name).not.toBe('');
      const composite = body.match(/primary key \(([^)]+)\)/)?.[1];
      const pk = composite ? composite.split(',').map((s) => s.trim()) : [body.match(/^\s*(\w+)\s[^\n]*primary key/m)?.[1]];
      expect(t.keys, t.name).toEqual(pk);
    }
  });

  it('no exported table has a secret-looking column in any migration', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const sql = readdirSync(dir)
      .map((f) => readFileSync(join(dir, f), 'utf8').replace(/--.*$/gm, ''))
      .join('\n');
    // reviewed by hand: an expiry date, and an API path (+ sorted query, never the token: lib/sync/store.ts)
    const ALLOWED = new Set(['accounts.token_expires_at', 'api_snapshots.endpoint']);
    let seen = 0;
    for (const t of EXPORT_TABLES) {
      const created = [...(sql.match(new RegExp(`create table public\\.${t.name} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? '').matchAll(/^\s*(\w+)\s/gm)].map((m) => m[1]);
      const added = [...sql.matchAll(/alter table public\.(\w+)([^;]*);/g)].filter((m) => m[1] === t.name).flatMap((m) => [...m[2].matchAll(/add column (\w+)/g)].map((a) => a[1]));
      for (const c of [...created, ...added]) {
        seen++;
        if (!ALLOWED.has(`${t.name}.${c}`)) expect(`${t.name}.${c}`).not.toMatch(/token|secret|password|keys|endpoint|refresh|credential/i);
      }
    }
    expect(seen).toBeGreaterThan(150); // the scan really read the columns (a broken regex would pass vacuously)
  });

  it('findExportTable accepts listed names only', () => {
    expect(findExportTable('media')?.name).toBe('media');
    for (const bad of [null, '', 'account_tokens', 'MEDIA', 'media;drop', '__proto__', 'toString']) expect(findExportTable(bad)).toBeNull();
  });
});

describe('keyset filter', () => {
  it('one key: strictly greater', () => {
    expect(afterFilter(['id'], { id: 'abc' })).toBe('id.gt."abc"');
  });

  it('composite keys: (a > A) or (a = A and b > B) or (a = A and b = B and c > C)', () => {
    expect(afterFilter(['a', 'b', 'c'], { a: 'x', b: '2026-10-01', c: 3 })).toBe('a.gt."x",and(a.eq."x",b.gt."2026-10-01"),and(a.eq."x",b.eq."2026-10-01",c.gt."3")');
  });

  it('quotes reserved characters: timestamps, commas, parentheses, quotes and backslashes', () => {
    expect(afterFilter(['media_id', 'captured_at'], { media_id: '17', captured_at: '2026-10-01T10:00:00.123456+00:00' })).toBe('media_id.gt."17",and(media_id.eq."17",captured_at.gt."2026-10-01T10:00:00.123456+00:00")');
    expect(quoteValue('a,b(c)"d\\e')).toBe('"a,b(c)\\"d\\\\e"');
  });
});

describe('exportPages', () => {
  it('pages in key order with the cursor of the last row, until an EMPTY page (a short page is not the end)', async () => {
    const t = findExportTable('media_metrics')!;
    const { db, calls } = fakeDb([[{ media_id: '1', captured_at: 't1' }, { media_id: '1', captured_at: 't2' }], [{ media_id: '2', captured_at: 't1' }], []]);
    expect(await collect(exportPages(db, t))).toHaveLength(2);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ table: 'media_metrics', select: '*', order: ['media_id:asc', 'captured_at:asc'], or: null, limit: PAGE_ROWS });
    expect(calls[1].or).toBe('media_id.gt."1",and(media_id.eq."1",captured_at.gt."t2")');
    expect(calls[2].or).toBe('media_id.gt."2",and(media_id.eq."2",captured_at.gt."t1")');
  });

  it('uses the table’s own page size', async () => {
    const { db, calls } = fakeDb([[]]);
    await collect(exportPages(db, findExportTable('follower_exports')!));
    expect(calls[0].limit).toBe(5);
  });

  it('a read error throws a fixed message (never the Supabase text)', async () => {
    const { db } = fakeDb([[{ id: 'a' }], { error: true }]);
    await expect(collect(exportPages(db, findExportTable('media')!))).rejects.toThrow(/^export read failed$/);
  });

  it('stops when the server ignores the cursor (the same page again) instead of looping forever', async () => {
    const { db } = fakeDb([[{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]]);
    await expect(collect(exportPages(db, findExportTable('media')!))).rejects.toThrow(/did not advance/);
  });
});

async function* gen(pages: Row[][], failAt?: number) {
  for (let i = 0; i < pages.length; i++) {
    if (i === failAt) throw new Error('db said: secret');
    yield pages[i];
  }
}

describe('jsonArrayStream', () => {
  it('writes one valid JSON array over all pages', async () => {
    const text = await new Response(jsonArrayStream(gen([[{ a: 1 }, { a: 2 }], [{ a: 3 }]]), Date.now() + 60_000)).text();
    expect(JSON.parse(text)).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('an empty table is []', async () => {
    expect(JSON.parse(await new Response(jsonArrayStream(gen([]), Date.now() + 60_000)).text())).toEqual([]);
  });

  it('a failure midway errors the stream, so the download fails instead of saving a cut-off file', async () => {
    await expect(new Response(jsonArrayStream(gen([[{ a: 1 }], [{ a: 2 }]], 1), Date.now() + 60_000)).blob()).rejects.toThrow();
  });

  it('past the time budget the stream errors too', async () => {
    let t = 0;
    const s = jsonArrayStream(gen([[{ a: 1 }], [{ a: 2 }]]), 10, () => (t += 6));
    await expect(new Response(s).text()).rejects.toThrow();
  });
});
