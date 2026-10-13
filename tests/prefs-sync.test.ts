import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DATE_FORMATS, DEFAULT_PREFS, DENSITIES, LOCALES, MODES, NUMBER_FORMATS, RADII, THEMES, TIME_FORMATS, WEEK_STARTS, type Prefs } from '@/lib/prefs';
import { prefsToProfileRow, profileRowToPrefs } from '@/lib/prefs.sync';

const custom: Prefs = { ...DEFAULT_PREFS, theme: 'forest', mode: 'dark', density: 'comfortable', radius: 'round', locale: 'zh-CN', dateFormat: 'DD/MM/YYYY', timeFormat: '12h', numberFormat: '1.234,5', weekStart: 'sun', timezone: 'Europe/London' };

describe('profile <-> prefs mapping', () => {
  it('round-trips every preference', () => {
    expect(profileRowToPrefs(prefsToProfileRow('u1', custom))).toEqual(custom);
  });

  it('writes snake_case columns the migration defines', () => {
    expect(prefsToProfileRow('u1', custom)).toMatchObject({
      user_id: 'u1', language: 'zh-CN', timezone: 'Europe/London', date_format: 'DD/MM/YYYY', time_format: '12h', number_format: '1.234,5', week_start: 'sun', theme: 'forest', mode: 'dark', density: 'comfortable', radius: 'round',
    });
  });

  it('a missing row is null, not defaults (so the caller can tell "no profile yet")', () => {
    expect(profileRowToPrefs(null)).toBeNull();
    expect(profileRowToPrefs(undefined)).toBeNull();
  });

  it('invalid column values fall back per field instead of throwing', () => {
    const p = profileRowToPrefs({ user_id: 'u', language: 'fr', theme: 'forest', timezone: 'Not/AZone', mode: 'dark' });
    expect(p).toMatchObject({ locale: DEFAULT_PREFS.locale, theme: 'forest', timezone: DEFAULT_PREFS.timezone, mode: 'dark' });
  });
});

// Pins the row keys and every CHECK list to the migration, so a renamed column or a new allowed value cannot drift silently.
describe('profile row vs the migration', () => {
  const sql = readFileSync('supabase/migrations/20261014000001_owner_and_profiles.sql', 'utf8');
  const table = sql.slice(sql.indexOf('create table public.profiles'), sql.indexOf('alter table public.profiles'));
  const checks = Object.fromEntries(
    [...table.matchAll(/^\s+(\w+)\s+text\b[^\n]*check \(\w+ in \(([^)]*)\)\)/gm)].map((m) => [m[1], [...m[2].matchAll(/'([^']*)'/g)].map((x) => x[1])]),
  );

  it('the row has exactly the preference columns the table defines', () => {
    const cols = [...table.matchAll(/^\s+(\w+)\s+(?:uuid|text|jsonb|timestamptz)\b/gm)].map((m) => m[1]);
    const prefCols = cols.filter((c) => c !== 'alert_settings' && c !== 'updated_at').sort();
    expect(Object.keys(prefsToProfileRow('u1', DEFAULT_PREFS)).sort()).toEqual(prefCols);
  });

  it('every allowed value in the app matches the CHECK list, in both directions', () => {
    expect(checks).toEqual({
      language: [...LOCALES], date_format: [...DATE_FORMATS], time_format: [...TIME_FORMATS], number_format: [...NUMBER_FORMATS],
      week_start: [...WEEK_STARTS], theme: [...THEMES], mode: [...MODES], density: [...DENSITIES], radius: [...RADII],
    });
  });

  it('the defaults match the column defaults', () => {
    const row = prefsToProfileRow('u1', DEFAULT_PREFS) as unknown as Record<string, string>;
    for (const m of table.matchAll(/^\s+(\w+)\s+text\s+not null default '([^']*)'/gm)) expect(row[m[1]], m[1]).toBe(m[2]);
  });
});
