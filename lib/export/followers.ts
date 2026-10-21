// The Excel export of ONE follower list (Plan 15b), on the owner's explicit click in the Followers tab; follower names
// are never part of the account workbook/PDF exports. Same cell rules as every export sheet (lib/export/workbook.ts):
// text goes through safeText (the formula-injection guard), follow times are real date-time cells in the owner's
// format, an unknown time is an EMPTY cell. A second sheet says what the list is and that it is snapshot-based.
import { sheetNames } from '@/lib/export/cells';
import { sheet, type Translate, type WorkbookSheet } from '@/lib/export/workbook';
import type { FormatPrefs } from '@/lib/format';
import { sinceKey, type FollowerList } from '@/lib/followers/diff';
import type { Person } from '@/lib/followers/parse';

export interface FollowerSheetInput {
  account: string; // the account's username
  list: FollowerList;
  newer: string; // the newer export's date, already formatted (lib/format.ts formatDay)
  older: string | null; // the older one's, null = no comparison
  people: Person[]; // already filtered and sorted (lib/followers/diff.ts filterList)
}

type AboutRow = { field: string; value: string | null };

export function buildFollowerSheets(d: FollowerSheetInput, t: Translate, prefs: FormatPrefs): WorkbookSheet[] {
  const k = (key: string, values?: Record<string, string | number>) => t(`pages.account.followerDiff.${key}`, values);
  const listName = k(`lists.${d.list}`);
  const people = sheet<Person>(
    listName,
    [
      { header: k('cols.username'), kind: 'text', width: 32, get: (p) => p.username },
      { header: k(`cols.${sinceKey(d.list)}`), kind: 'datetime', width: 18, get: (p) => (p.at === null ? null : new Date(p.at * 1000).toISOString()) },
      { header: k('sheet.profile'), kind: 'text', width: 44, get: (p) => `https://www.instagram.com/${p.username}/` },
    ],
    d.people,
    { prefs },
  );
  const diff = d.list === 'new' || d.list === 'lost'; // only these two depend on two files; "snapshot-based" is true of them alone
  const hint = d.older === null && diff ? '' : k(`hints.${d.list}`, { newer: d.newer, older: d.older ?? '' });
  const note = diff && d.older !== null ? k('snapshotBased') : '';
  const about = sheet<AboutRow>(
    k('sheet.about'),
    [
      { header: k('sheet.field'), kind: 'text', width: 18, get: (r) => r.field },
      { header: k('sheet.value'), kind: 'text', width: 90, get: (r) => r.value },
    ],
    [
      { field: k('sheet.account'), value: d.account },
      { field: k('sheet.list'), value: listName },
      { field: k('sheet.newer'), value: d.newer },
      { field: k('sheet.older'), value: d.older },
      { field: k('sheet.note'), value: `${hint} ${note}`.trim() },
    ],
    { prefs },
  );
  const names = sheetNames([people.name, about.name]);
  return [people, about].map((s, i) => ({ sheet: names[i], data: s.data, columns: s.columns, stickyRowsCount: s.stickyRowsCount }));
}
