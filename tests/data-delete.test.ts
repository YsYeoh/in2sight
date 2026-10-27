// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deleteAllData, removeAllCovers } from '@/lib/data/delete';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

/** A fake service-role client: an rpc answer and a covers bucket held as a Map of folder -> file names. */
function fakeAdmin(o: { rpc?: { data: unknown; error: unknown } | 'throw'; files?: Record<string, string[]>; listFails?: boolean; removeFails?: boolean }) {
  const files = new Map(Object.entries(o.files ?? {}));
  const calls: string[] = [];
  const bucket = {
    async list(prefix: string, opts: { limit: number }) {
      calls.push(`list:${prefix || '/'}`);
      if (o.listFails) return { data: null, error: { message: 'down' } };
      if (prefix === '') return { data: [...files.keys()].map((name) => ({ name, id: null })), error: null };
      return { data: (files.get(prefix) ?? []).slice(0, opts.limit).map((name) => ({ name, id: 'x' })), error: null };
    },
    async remove(paths: string[]) {
      calls.push(`remove:${paths.length}`);
      if (o.removeFails) return { data: null, error: { message: 'down' } };
      for (const p of paths) {
        const [folder, name] = p.split('/');
        const left = (files.get(folder) ?? []).filter((n) => n !== name);
        if (left.length) files.set(folder, left);
        else files.delete(folder);
      }
      return { data: [], error: null };
    },
  };
  const admin = {
    async rpc(fn: string) {
      calls.push(`rpc:${fn}`);
      if (o.rpc === 'throw') throw new Error('network');
      return o.rpc ?? { data: { accounts: 2, tags: 1, views: 0 }, error: null };
    },
    storage: { from: (b: string) => (calls.push(`bucket:${b}`), bucket) },
  };
  return { admin: admin as never, calls, files };
}

describe('deleteAllData', () => {
  it('the database first (one rpc), then every cover folder of the bucket, then a check that it is empty', async () => {
    const f = fakeAdmin({ files: { [A]: ['m1.jpg', 'm2.jpg'], [B]: ['m3.jpg'] } });
    expect(await deleteAllData(f.admin)).toEqual({ ok: true, accounts: 2, coversDone: true });
    expect(f.calls[0]).toBe('rpc:delete_all_data');
    expect(f.calls.filter((c) => c.startsWith('rpc:'))).toHaveLength(1);
    expect(f.calls.every((c) => !c.startsWith('bucket:') || c === 'bucket:covers')).toBe(true);
    expect(f.files.size).toBe(0);
  });

  it('a failed rpc deletes nothing else (no Storage call) and maps a missing function to needs_update', async () => {
    const missing = fakeAdmin({ rpc: { data: null, error: { code: 'PGRST202' } }, files: { [A]: ['m1.jpg'] } });
    expect(await deleteAllData(missing.admin)).toEqual({ ok: false, error: 'needs_update' });
    expect(missing.calls).toEqual(['rpc:delete_all_data']);
    const failed = fakeAdmin({ rpc: { data: null, error: { code: '57014', message: 'secret' } } });
    expect(await deleteAllData(failed.admin)).toEqual({ ok: false, error: 'unexpected' });
    expect(await deleteAllData(fakeAdmin({ rpc: 'throw' }).admin)).toEqual({ ok: false, error: 'unexpected' });
  });

  it('a second run is harmless: zero accounts, an empty bucket', async () => {
    const f = fakeAdmin({ rpc: { data: { accounts: 0, tags: 0, views: 0 }, error: null } });
    expect(await deleteAllData(f.admin)).toEqual({ ok: true, accounts: 0, coversDone: true });
  });

  it('a malformed rpc answer counts as 0 accounts, not NaN', async () => {
    expect(await deleteAllData(fakeAdmin({ rpc: { data: null, error: null } }).admin)).toEqual({ ok: true, accounts: 0, coversDone: true });
  });
});

describe('removeAllCovers', () => {
  it('also removes folders of accounts that no longer exist; ignores names that are not account ids', async () => {
    const f = fakeAdmin({ files: { [B]: ['old.jpg'], 'not-an-id': ['x'] } });
    expect(await removeAllCovers(f.admin)).toBe(true); // only uuid folders count as "left"
    expect(f.files.has(B)).toBe(false);
    expect(f.files.has('not-an-id')).toBe(true);
  });

  it('reports false when the bucket cannot be listed or a remove fails (the owner runs it again)', async () => {
    expect(await removeAllCovers(fakeAdmin({ listFails: true }).admin)).toBe(false);
    expect(await removeAllCovers(fakeAdmin({ files: { [A]: ['m1.jpg'] }, removeFails: true }).admin)).toBe(false);
  });
});
