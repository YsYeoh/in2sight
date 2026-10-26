// Settings sections (Plan 16a): ids, order and icons in ONE place. Titles and descriptions are the i18n keys
// `settings.sections.<id>.title` / `.description`. Each id has one component `components/settings/sections/<Id>Section.tsx`
// (mapped in app/(app)/settings/[[...section]]/page.tsx). Plans 16b/16c replace SecuritySection / DataSection; they never add ids.
import { Bell, Database, Languages, Palette, RefreshCw, ShieldCheck, type LucideIcon } from 'lucide-react';

export const SECTION_IDS = ['appearance', 'language', 'notifications', 'accounts', 'security', 'data'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SettingsSection {
  id: SectionId;
  icon: LucideIcon;
}

export const SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', icon: Palette },
  { id: 'language', icon: Languages },
  { id: 'notifications', icon: Bell },
  { id: 'accounts', icon: RefreshCw },
  { id: 'security', icon: ShieldCheck },
  { id: 'data', icon: Database },
];

export const DEFAULT_SECTION: SectionId = 'appearance';

export const isSectionId = (v: unknown): v is SectionId => typeof v === 'string' && (SECTION_IDS as readonly string[]).includes(v);

export const sectionHref = (id: SectionId): string => `/settings/${id}`;

/** The tabs of the old one-page Settings (client state only, but honoured if they ever arrive as ?tab=). */
const LEGACY_TABS: Readonly<Record<string, SectionId>> = { general: 'appearance', notifications: 'notifications', account: 'security' };

/**
 * What a settings URL shows. `segments` = the optional catch-all param (undefined for /settings), `tab` = a `?tab=` value.
 * /settings (any tab) -> a redirect; /settings/<known id> -> that section; anything else -> null (404).
 */
export function routeSettings(segments: readonly string[] | undefined, tab: string | undefined): { section: SectionId } | { redirect: string } | null {
  if (!segments || segments.length === 0) return { redirect: sectionHref(tab !== undefined && Object.hasOwn(LEGACY_TABS, tab) ? LEGACY_TABS[tab] : DEFAULT_SECTION) };
  if (segments.length === 1 && isSectionId(segments[0])) return { section: segments[0] };
  return null;
}
