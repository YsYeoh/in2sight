// The devices list of Settings -> Notifications (Plan 16a). Owner-session reads only (RLS push_subscriptions_owner_all).
// The endpoint (a capability URL) and the keys never leave the server: the list carries ids, a label and a date.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PushDevice {
  id: number;
  /** "Chrome · Windows"; null = not recognised (the UI says "Unknown device") */
  label: string | null;
  createdAt: string;
}

export const DEVICES_MAX = 20; // = MAX_SUBSCRIPTIONS in app/(app)/settings/actions.ts

// Order matters: Edge and Opera also say "Chrome", Chrome also says "Safari", iPad/iPhone also say "Mac OS X".
const BROWSERS: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPad/, 'iPad'],
  [/iPhone|iPod/, 'iPhone'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** A short product label from a stored user agent; literal names (not translated). */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (typeof userAgent !== 'string' || userAgent.trim() === '') return null;
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1];
  return [browser, system].filter(Boolean).join(' · ') || null;
}

/** Newest first, at most DEVICES_MAX. null = the read failed (the UI says so; never a fake empty list). Never throws. */
export async function listPushDevices(db: SupabaseClient): Promise<PushDevice[] | null> {
  try {
    const { data, error } = await db.from('push_subscriptions').select('id,user_agent,created_at').order('created_at', { ascending: false }).limit(DEVICES_MAX);
    if (error || !data) return null;
    return (data as { id: number; user_agent: string | null; created_at: string }[]).map((r) => ({ id: Number(r.id), label: deviceLabel(r.user_agent), createdAt: r.created_at }));
  } catch {
    return null;
  }
}
