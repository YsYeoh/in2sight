// Plan sections (Plan 17d; the Settings pattern of lib/settings/sections.ts): ids and order in ONE place, URL
// /plan/<id>. Titles and descriptions are `plan.sections.<id>.title` / `.description`. Plan 17f adds 'board'.
export const PLAN_SECTIONS = ['digest', 'goals'] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];
export const DEFAULT_PLAN_SECTION: PlanSection = 'digest';

export const isPlanSection = (v: unknown): v is PlanSection => typeof v === 'string' && (PLAN_SECTIONS as readonly string[]).includes(v);
export const planHref = (id: PlanSection): string => `/plan/${id}`;

/** /plan -> a redirect to the first section; /plan/<known id> -> that section; anything else -> null (404). */
export function routePlan(segments: readonly string[] | undefined): { section: PlanSection } | { redirect: string } | null {
  if (!segments || segments.length === 0) return { redirect: planHref(DEFAULT_PLAN_SECTION) };
  if (segments.length === 1 && isPlanSection(segments[0])) return { section: segments[0] };
  return null;
}
