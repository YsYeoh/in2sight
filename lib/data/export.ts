import type { SupabaseClient } from '@supabase/supabase-js';

// "Export all" (Plan 16c): every table that holds the owner's data, read through the OWNER session (RLS), one JSON file
// per table, streamed page by page. Never the admin client, so account_tokens is out of reach by privilege, not by care.
// NOT exported, on purpose: account_tokens (access tokens), push_subscriptions (a push endpoint and its keys are
// credentials for this device), owners, sync_state / sync_progress / sync_runs (bookkeeping, no insight).
export type Row = Record<string, unknown>;

export interface ExportTable {
  name: string;
  /** The primary key columns: the sort order and the keyset cursor (PostgREST answers at most 1,000 rows per request). */
  keys: readonly string[];
  /** Rows per request; smaller for tables with big rows (a follower export holds up to 50,000 names). */
  page?: number;
  /** Other people's personal data: left out of "Download all" unless the owner ticks the box. */
  thirdParty?: boolean;
}

export const EXPORT_TABLES = [
  { name: 'accounts', keys: ['id'] },
  { name: 'account_daily', keys: ['account_id', 'day'] },
  { name: 'account_daily_breakdown', keys: ['account_id', 'day', 'metric', 'follow_type', 'product_type'] },
  { name: 'audience_snapshots', keys: ['account_id', 'day', 'kind'] },
  { name: 'online_followers', keys: ['account_id', 'day'] },
  { name: 'follower_snapshots', keys: ['account_id', 'captured_at'] },
  { name: 'api_snapshots', keys: ['id'], page: 100 },
  { name: 'media', keys: ['id'] },
  { name: 'media_metrics', keys: ['media_id', 'captured_at'] },
  { name: 'media_children', keys: ['media_id', 'position'] },
  { name: 'tags', keys: ['id'] },
  { name: 'media_tags', keys: ['media_id', 'tag_id'] },
  { name: 'explorer_views', keys: ['id'] },
  { name: 'notifications', keys: ['id'] },
  { name: 'moderation_settings', keys: ['account_id'] },
  { name: 'moderation_rules', keys: ['id'] },
  { name: 'moderation_log', keys: ['id'] },
  { name: 'profiles', keys: ['user_id'] },
  { name: 'comments', keys: ['id'], thirdParty: true },
  { name: 'follower_exports', keys: ['id'], page: 5, thirdParty: true },
] as const satisfies readonly ExportTable[];

export type ExportTableName = (typeof EXPORT_TABLES)[number]['name'];

export const PAGE_ROWS = 1000;

export function findExportTable(name: string | null): ExportTable | null {
  return EXPORT_TABLES.find((t) => t.name === name) ?? null;
}

/** A PostgREST filter value, always double-quoted (timestamps contain `:` `.` `+`), `\` and `"` escaped. */
export const quoteValue = (v: unknown): string => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Rows strictly after `last` in key order: (a > A) or (a = A and b > B) or … — the body of a PostgREST `or=(…)`. */
export function afterFilter(keys: readonly string[], last: Row): string {
  return keys
    .map((k, i) => {
      const gt = `${k}.gt.${quoteValue(last[k])}`;
      return i === 0 ? gt : `and(${[...keys.slice(0, i).map((e) => `${e}.eq.${quoteValue(last[e])}`), gt].join(',')})`;
    })
    .join(',');
}

const sameKey = (keys: readonly string[], a: Row, b: Row) => keys.every((k) => String(a[k]) === String(b[k]));

/**
 * Every row of one table in key order, one page per request, until a page comes back EMPTY (never "shorter than
 * asked": a lower server row cap would otherwise end the file early). Throws a fixed message on any read error (never
 * the Supabase text) and when a page repeats the previous cursor row (a filter the server ignored would loop forever).
 */
export async function* exportPages(db: SupabaseClient, t: ExportTable): AsyncGenerator<Row[]> {
  const size = t.page ?? PAGE_ROWS;
  let last: Row | null = null;
  for (;;) {
    let q = db.from(t.name).select('*');
    for (const k of t.keys) q = q.order(k, { ascending: true });
    if (last) q = q.or(afterFilter(t.keys, last));
    const { data, error } = await q.limit(size);
    if (error || !Array.isArray(data)) throw new Error('export read failed');
    if (data.length === 0) return;
    const rows = data as Row[];
    if (last && rows.some((r) => sameKey(t.keys, r, last as Row))) throw new Error('export cursor did not advance');
    yield rows;
    last = rows[rows.length - 1];
  }
}

/**
 * A JSON array streamed page by page. The closing `]` is written only after the last page, and any failure (a read
 * error, the time budget) ERRORS the stream, so the browser's download fails instead of saving a cut-off file.
 */
export function jsonArrayStream(pages: AsyncIterable<Row[]>, deadlineMs: number, now: () => number = Date.now): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = pages[Symbol.asyncIterator]();
  let first = true;
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode('['));
    },
    async pull(c) {
      try {
        if (now() > deadlineMs) throw new Error('export took too long');
        const r = await it.next();
        if (r.done) {
          c.enqueue(enc.encode(first ? ']\n' : '\n]\n'));
          c.close();
          return;
        }
        c.enqueue(enc.encode((first ? '\n' : ',\n') + r.value.map((row) => JSON.stringify(row)).join(',\n')));
        first = false;
      } catch {
        c.error(new Error('export failed')); // fixed text: never the cause (it could quote a value)
        void it.return?.(undefined);
      }
    },
    cancel() {
      void it.return?.(undefined);
    },
  });
}
