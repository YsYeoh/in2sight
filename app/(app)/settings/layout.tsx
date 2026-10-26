import { getTranslations } from 'next-intl/server';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { PageHeader } from '@/components/shared/PageHeader';

// The Settings shell (Plan 16a): header + section nav stay while a section streams in ([[...section]]/loading.tsx).
// The (app) layout above already checked the owner; every section page checks again (layouts don't re-run on navigation).
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('settings');
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-[var(--gp)] md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] md:items-start">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
