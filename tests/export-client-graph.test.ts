// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// PrintShell is a client component: its runtime import graph must not reach the server-only readers/stores.
const RUNTIME_IMPORT = /^import\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](@\/[^'"]+)['"]/gm;
function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const file = ['.ts', '.tsx'].map((e) => `${entry.replace('@/', '')}${e}`).find(existsSync);
  if (!file) return seen;
  for (const m of readFileSync(file, 'utf8').matchAll(RUNTIME_IMPORT)) graph(m[1], seen);
  return seen;
}

describe('client module graph', () => {
  it('PrintShell never pulls the export readers, the sync store or the accounts store', () => {
    const mods = [...graph('@/components/report/PrintShell')];
    expect(mods).toContain('@/lib/export/report'); // the walk really goes deep (report.ts only imports params' types now)
    expect(mods.filter((m) => /export\/read|sync\/store|supabase-store|dashboard\/read/.test(m))).toEqual([]);
  });
});
