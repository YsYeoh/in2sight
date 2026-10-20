import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

// Guards for docs/UI_STANDARDS.md. Each failure names the rule it breaks.
const root = process.cwd();
const read = (f: string) => readFileSync(join(root, f), 'utf8');
function files(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    return statSync(join(root, p)).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const src = ['app', 'components', 'lib'].flatMap(files).map((f) => [f, read(f)] as const);
const flat = (o: Record<string, unknown>, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) => (v !== null && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)] as [string, string]]));

describe('UI standards (docs/UI_STANDARDS.md)', () => {
  it('rule 6: no abbreviated range labels (7d, 1y, YTD) in any UI string, in either language', () => {
    for (const [k, v] of [...flat(en), ...flat(zh)]) expect(v, k).not.toMatch(/(^|[^\w{#])\d{1,3}[dwmyh](?!\w)|\bYTD\b/);
    for (const v of Object.values(zh.timeScope.preset)) expect([...v].length, v).toBeGreaterThanOrEqual(4); // 最近 7 天, not 7天
  });

  it('rule 4: the range bar is on trend pages only; TimeScopeBar is gone', () => {
    const users = src.filter(([, s]) => /<RangeBar\b/.test(s)).map(([f]) => f).sort();
    expect(users).toEqual(['app/styleguide/StandardsGallery.tsx', 'components/account/AccountView.tsx', 'components/calendar/CalendarView.tsx', 'components/explorer/ExplorerView.tsx', 'components/overview/OverviewView.tsx']);
    expect(src.filter(([, s]) => /TimeScopeBar/.test(s)).map(([f]) => f)).toEqual([]);
  });

  it('rule 7: page sections use underline tabs (the styleguide keeps one pill demo)', () => {
    for (const [f, s] of src) {
      if (f === 'app/styleguide/Gallery.tsx') continue;
      for (const m of s.matchAll(/<TabsList\b[^>]*>/g)) expect(m[0], f).toMatch(/variant="line"/);
    }
  });

  it('rule 5: header action rows and toolbars use one (default) button size', () => {
    for (const f of ['components/account/AccountView.tsx', 'components/export/ExportDialog.tsx', 'components/explorer/ExplorerView.tsx', 'components/explorer/ExplorerToolbar.tsx']) expect(read(f), f).not.toMatch(/size="sm"/);
  });

  it('rule 8: one scrollbar, styled only in styles/scrollbar.css', () => {
    for (const [f, s] of src) expect(s, f).not.toMatch(/scrollbar-(width|color|gutter)|::-webkit-scrollbar/);
  });
});
