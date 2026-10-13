import { parsePrefs, type Prefs } from '@/lib/prefs';

/** Preference columns of public.profiles (see supabase/migrations/20261014000001_owner_and_profiles.sql). */
export interface ProfileRow {
  user_id: string;
  language: string;
  timezone: string;
  date_format: string;
  time_format: string;
  number_format: string;
  week_start: string;
  theme: string;
  mode: string;
  density: string;
  radius: string;
}

const COLUMN: Record<keyof Prefs, Exclude<keyof ProfileRow, 'user_id'>> = {
  locale: 'language',
  timezone: 'timezone',
  dateFormat: 'date_format',
  timeFormat: 'time_format',
  numberFormat: 'number_format',
  weekStart: 'week_start',
  theme: 'theme',
  mode: 'mode',
  density: 'density',
  radius: 'radius',
};

/** Only the named preferences (plus user_id): an upsert of this leaves every other column as stored. */
export function prefsPatchToRow(userId: string, p: Prefs, keys: readonly (keyof Prefs)[]): Partial<ProfileRow> & { user_id: string } {
  const row: Partial<ProfileRow> & { user_id: string } = { user_id: userId };
  for (const k of keys) row[COLUMN[k]] = p[k];
  return row;
}

export function prefsToProfileRow(userId: string, p: Prefs): ProfileRow {
  return prefsPatchToRow(userId, p, Object.keys(COLUMN) as (keyof Prefs)[]) as ProfileRow;
}

/** null = no profile row yet; otherwise a complete Prefs (invalid columns fall back per field via parsePrefs). */
export function profileRowToPrefs(row: unknown): Prefs | null {
  if (row === null || row === undefined || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  return parsePrefs({
    locale: r.language,
    timezone: r.timezone,
    dateFormat: r.date_format,
    timeFormat: r.time_format,
    numberFormat: r.number_format,
    weekStart: r.week_start,
    theme: r.theme,
    mode: r.mode,
    density: r.density,
    radius: r.radius,
  });
}
