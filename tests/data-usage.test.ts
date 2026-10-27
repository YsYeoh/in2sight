// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readUsage, summariseUsage, USAGE_GROUPS } from '@/lib/data/usage';

const A = '11111111-1111-1111-1111-111111111111';

describe('summariseUsage', () => {
  it('folds tables into groups (unknown tables go to "other"), covers per folder, the database total', () => {
    const u = summariseUsage([
      { kind: 'table', label: 'media', row_count: 10, bytes: 1000 },
      { kind: 'table', label: 'media_metrics', row_count: '90', bytes: '9000' },
      { kind: 'table', label: 'comments', row_count: 5, bytes: 500 },
      { kind: 'table', label: 'follower_exports', row_count: 2, bytes: 2_000_000 },
      { kind: 'table', label: 'tags', row_count: 3, bytes: 300 },
      { kind: 'table', label: 'something_new', row_count: 1, bytes: 100 },
      { kind: 'covers', label: A, row_count: 4, bytes: 4096 },
      { kind: 'covers', label: 'b', row_count: 1, bytes: 9000 },
      { kind: 'database', label: null, row_count: null, bytes: '12345678' },
    ]);
    expect(u.groups.map((g) => g.id)).toEqual([...USAGE_GROUPS]);
    expect(u.groups.find((g) => g.id === 'posts')).toEqual({ id: 'posts', rows: 100, bytes: 10_000 });
    expect(u.groups.find((g) => g.id === 'comments')).toEqual({ id: 'comments', rows: 5, bytes: 500 });
    expect(u.groups.find((g) => g.id === 'followers')).toEqual({ id: 'followers', rows: 2, bytes: 2_000_000 });
    expect(u.groups.find((g) => g.id === 'other')).toEqual({ id: 'other', rows: 4, bytes: 400 });
    expect(u.groups.find((g) => g.id === 'insights')).toEqual({ id: 'insights', rows: 0, bytes: 0 });
    expect(u.covers).toEqual([
      { folder: 'b', files: 1, bytes: 9000 },
      { folder: A, files: 4, bytes: 4096 },
    ]);
    expect(u.database).toBe(12_345_678);
  });

  it('a table never analysed (null estimate) makes its group’s row count unknown, never 0', () => {
    const u = summariseUsage([
      { kind: 'table', label: 'media', row_count: null, bytes: 100 },
      { kind: 'table', label: 'media_metrics', row_count: 5, bytes: 100 },
    ]);
    expect(u.groups.find((g) => g.id === 'posts')).toEqual({ id: 'posts', rows: null, bytes: 200 });
    expect(u.database).toBeNull();
  });
});

describe('readUsage', () => {
  it('calls the data_usage function on the given (owner) client', async () => {
    const calls: string[] = [];
    const db = { rpc: async (fn: string) => (calls.push(fn), { data: [{ kind: 'database', label: null, row_count: null, bytes: 1 }], error: null }) };
    expect((await readUsage(db as never))?.database).toBe(1);
    expect(calls).toEqual(['data_usage']);
  });

  it('null when the migration is missing, the call fails or throws', async () => {
    expect(await readUsage({ rpc: async () => ({ data: null, error: { code: 'PGRST202' } }) } as never)).toBeNull();
    expect(await readUsage({ rpc: async () => ({ data: 'x', error: null }) } as never)).toBeNull();
    expect(
      await readUsage({
        rpc: async () => {
          throw new Error('down');
        },
      } as never),
    ).toBeNull();
  });
});
