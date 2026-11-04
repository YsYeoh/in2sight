'use client';

// The Plan sections (Plan 17d) as underline tabs (UI standard 7). Each section has its own URL (/plan/<id>, the Settings
// pattern); choosing one navigates, after the unsaved-changes question when a goals form is dirty. activationMode
// "manual": arrowing between tabs does not navigate per key press.
import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { confirmLeave } from '@/components/settings/unsaved';
import { startProgress } from '@/components/shared/NavigationProgress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isActive } from '@/lib/nav';
import { DEFAULT_PLAN_SECTION, PLAN_SECTIONS, isPlanSection, planHref } from '@/lib/plan/sections';

export function PlanNav() {
  const t = useTranslations('plan.sections');
  const tu = useTranslations('settings.unsaved');
  const pathname = usePathname();
  const router = useRouter();
  const [, start] = useTransition();
  const active = PLAN_SECTIONS.find((id) => isActive(pathname, planHref(id))) ?? DEFAULT_PLAN_SECTION;
  const choose = (v: string) => {
    if (!isPlanSection(v) || v === active || !confirmLeave(tu('confirm'))) return;
    startProgress(planHref(v)); // router.push is not a link click: tell the top bar
    start(() => router.push(planHref(v)));
  };
  return (
    <Tabs value={active} activationMode="manual" onValueChange={choose} className="mb-[var(--gp)] min-w-0">
      <TabsList variant="line" aria-label={t('label')}>
        {PLAN_SECTIONS.map((id) => (
          <TabsTrigger key={id} value={id} className="flex-none">
            {t(`${id}.title`)}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
