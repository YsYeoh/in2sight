// @vitest-environment node
// fflate is write-excel-file's own zip dependency (always installed with it); the tests use it to open the real file.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { CellObject } from 'write-excel-file/node';
import { buildWorkbook, translator, writeWorkbook, type WorkbookOptions } from '@/lib/export/workbook';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { A, NOW, post, sampleData, TODAY, TZ } from './fixtures/export-data';

const GRIN = '\u{1F600}'; // 😀
const opts = (o: Partial<WorkbookOptions> = {}): WorkbookOptions => ({ period: 30, today: TODAY, now: NOW, prefs: { ...DEFAULT_PREFS, timezone: TZ, dateFormat: 'YYYY-MM-DD' }, scopeName: 'Brand X', ...o });
const en = translator('en');
const cell = (c: unknown) => c as CellObject | null;
const col = (rows: unknown[][], header: string) => {
  const i = (rows[0] as CellObject[]).findIndex((h) => h.value === header);
  if (i < 0) throw new Error(`no column ${header}`);
  return rows.slice(1).map((r) => cell(r[i]));
};
const files = async (sheets: ReturnType<typeof buildWorkbook>) => {
  const zip = unzipSync(new Uint8Array(await writeWorkbook(sheets)));
  return Object.fromEntries(Object.entries(zip).map(([k, v]) => [k, strFromU8(v)]));
};

describe('buildWorkbook', () => {
  it('six sheets with localized, valid names (en and zh-CN)', () => {
    expect(buildWorkbook(sampleData(), en, opts()).map((s) => s.sheet)).toEqual(['Summary', 'Daily', 'Posts', 'Stories', 'Audience', 'Tags']);
    const zh = buildWorkbook(sampleData(), translator('zh-CN'), opts({ prefs: { ...DEFAULT_PREFS, locale: 'zh-CN', timezone: TZ } }));
    expect(zh.map((s) => s.sheet)).toEqual(['概要', '每日数据', '帖子', '快拍', '受众', '标签']);
    expect((zh[2].data[0] as CellObject[]).map((h) => h.value)).toContain('文案');
  });

  it('every sheet: bold header row, frozen, one width per column', () => {
    for (const s of buildWorkbook(sampleData(), en, opts())) {
      expect(s.stickyRowsCount).toBe(1);
      const header = s.data[0] as CellObject[];
      expect(header.every((h) => h.fontWeight === 'bold' && typeof h.value === 'string')).toBe(true);
      expect(s.columns).toHaveLength(header.length);
    }
  });

  it('Summary: numbers are number cells, an account without data has EMPTY cells (not 0), the group total is last', () => {
    const [summary] = buildWorkbook(sampleData(), en, opts());
    expect(col(summary.data, 'Account').map((c) => c?.value)).toEqual(['brand.one', `'=brand${GRIN}/two`, 'Brand X']);
    const reach = col(summary.data, 'Reach');
    expect(reach[0]).toEqual({ value: 2000, type: Number, format: '#,##0' }); // 20 days of data x 100
    expect(reach[1]).toBeNull();
    expect(reach[2]?.value).toBe(2000); // the empty account does not drag the total
    expect(col(summary.data, 'Engagement')[0]).toEqual({ value: 0.1, type: Number, format: '0.0%' });
    expect(col(summary.data, 'From')[0]).toMatchObject({ type: Date, format: 'yyyy-mm-dd' });
    expect(col(summary.data, 'Last synced')[0]).toMatchObject({ type: Date, format: 'yyyy-mm-dd hh:mm' });
    expect((col(summary.data, 'Last synced')[0]?.value as Date).toISOString()).toBe('2026-10-15T11:00:00.000Z'); // 03:00Z in Kuala Lumpur
  });

  it('Daily: one row per day in the window, real date cells in the owner format', () => {
    const [, daily] = buildWorkbook(sampleData(), en, opts({ period: 7, prefs: { ...DEFAULT_PREFS, timezone: TZ, dateFormat: 'DD/MM/YYYY' } }));
    const day = col(daily.data, 'Date');
    expect(day).toHaveLength(6); // 2026-10-09 .. 2026-10-14 (no row for today yet)
    expect(day[0]).toEqual({ value: new Date('2026-10-09T00:00:00Z'), type: Date, format: 'dd/mm/yyyy' });
    expect(col(daily.data, 'Link taps').every((c) => c === null)).toBe(true);
  });

  it('Posts: formula-like captions and tag names are neutralised; missing metrics stay empty; type is localized', () => {
    const posts = buildWorkbook(sampleData(), en, opts())[2];
    expect(col(posts.data, 'Caption').map((c) => c?.value ?? null)).toEqual(["'=1+1 cmd", null]);
    expect(col(posts.data, 'Tags')[0]?.value).toBe("'=evil tag");
    expect(col(posts.data, 'Type')[0]?.value).toBe('Reel');
    expect(col(posts.data, 'Likes')[1]).toBeNull();
    expect(col(posts.data, 'Engagement')[1]).toBeNull();
    expect(col(posts.data, 'Engagement')[0]).toEqual({ value: 0.16, type: Number, format: '0.0%' });
  });

  it('Stories, Audience, Tags', () => {
    const [, , , stories, audience, tags] = buildWorkbook(sampleData(), en, opts());
    expect(col(stories.data, 'Exit rate')[0]?.value).toBe(0.1);
    expect(col(audience.data, 'Item').map((c) => c?.value)).toEqual(['18-24 · Women', '18-24 · Men', 'Malaysia (MY)', 'Singapore (SG)', "'=Kuala Lumpur"]);
    expect(col(audience.data, 'Share')[0]?.value).toBe(0.6);
    expect(col(tags.data, 'Tag').map((c) => c?.value)).toEqual(["'=evil tag", 'Untagged']);
  });

  it('no accounts at all: six sheets with just their header row, and still a valid file', async () => {
    const empty = { accounts: [], sync: {}, daily: {}, posts: {}, stories: {}, audience: {}, online: {}, tags: [] };
    const sheets = buildWorkbook(empty, en, opts());
    expect(sheets.map((s) => s.data.length)).toEqual([1, 1, 1, 1, 1, 2]); // Tags keeps the "Untagged" row (0 posts)
    const f = await files(sheets);
    expect(f['xl/workbook.xml']).toContain('name="Summary"');
  });
});

describe('writeWorkbook (real .xlsx)', () => {
  it('opens as a zip with six sheets, frozen header panes, text never stored as a formula, no secrets', async () => {
    const f = await files(buildWorkbook(sampleData(), en, opts()));
    for (const n of ['Summary', 'Daily', 'Posts', 'Stories', 'Audience', 'Tags']) expect(f['xl/workbook.xml']).toContain(`name="${n}"`);
    expect(f['xl/worksheets/sheet1.xml']).toMatch(/<pane [^>]*state="frozen"/);
    const all = Object.values(f).join('\n');
    expect(all).not.toMatch(/<f>/); // no formula cells anywhere
    expect(f['xl/sharedStrings.xml']).toContain("'=1+1 cmd");
    expect(all).not.toMatch(/access_token|token/i);
  });

  it('500 posts on one account: every post gets a row, quickly', async () => {
    const data = sampleData();
    data.posts[A] = Array.from({ length: 500 }, (_, i) => post(`n${i}`, A, { postedAt: `2026-10-${String(1 + (i % 14)).padStart(2, '0')}T02:00:00Z`, caption: `${'长'.repeat(200)} ${i}` }));
    const started = Date.now();
    const sheets = buildWorkbook(data, en, opts());
    expect(sheets[2].data).toHaveLength(501);
    const f = await files(sheets);
    expect(f['xl/worksheets/sheet3.xml'].match(/<row /g)).toHaveLength(501);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
