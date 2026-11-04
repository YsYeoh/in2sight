import { getTranslations } from 'next-intl/server';
import { PlanNav } from '@/components/plan/PlanNav';
import { PageHeader } from '@/components/shared/PageHeader';

// The Plan shell (Plan 17d): header + section tabs stay while a section streams in ([[...section]]/loading.tsx).
// The (app) layout already checked the owner; the section page checks again (layouts don't re-run on navigation).
export default async function PlanLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('plan');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <PlanNav />
      <div className="min-w-0">{children}</div>
    </>
  );
}
