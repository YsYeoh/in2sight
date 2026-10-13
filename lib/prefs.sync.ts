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

export function prefsToProfileRow(userId: string, p: Prefs): ProfileRow {
  return {
    user_id: userId,
    language: p.locale,
    timezone: p.timezone,
    date_format: p.dateFormat,
    time_format: p.timeFormat,
    number_format: p.numberFormat,
    week_start: p.weekStart,
    theme: p.theme,
    mode: p.mode,
    density: p.density,
    radius: p.radius,
  };
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
