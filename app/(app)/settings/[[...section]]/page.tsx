import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AccountsSection } from '@/components/settings/sections/AccountsSection';
import { AppearanceSection } from '@/components/settings/sections/AppearanceSection';
import { DataSection } from '@/components/settings/sections/DataSection';
import { LanguageSection } from '@/components/settings/sections/LanguageSection';
import { NotificationsSection } from '@/components/settings/sections/NotificationsSection';
import { SecuritySection } from '@/components/settings/sections/SecuritySection';
import { requireOwner } from '@/lib/auth/require-owner';
import { routeSettings, type SectionId } from '@/lib/settings/sections';

// Server actions inherit the page's limit: Accounts & sync's "Sync now" runs a tick (35 s budget) inside the action.
export const maxDuration = 60;

// One zero-prop component per section (lib/settings/sections.ts). Plans 16b/16c replace a file, never this map.
const VIEWS = {
  appearance: AppearanceSection,
  language: LanguageSection,
  notifications: NotificationsSection,
  accounts: AccountsSection,
  security: SecuritySection,
  data: DataSection,
} satisfies Record<SectionId, unknown>;

export default async function SettingsSectionPage({ params, searchParams }: { params: Promise<{ section?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner(); // layouts don't re-run on client navigation, so the page checks too
  const [{ section }, sp] = await Promise.all([params, searchParams]);
  const route = routeSettings(section, typeof sp.tab === 'string' ? sp.tab : undefined);
  if (!route) notFound();
  if ('redirect' in route) redirect(route.redirect);
  const t = await getTranslations('settings.sections');
  const View = VIEWS[route.section];
  return (
    <section aria-labelledby="settings-section-title" className="grid min-w-0 gap-[var(--gp)]">
      <header>
        <h2 id="settings-section-title" className="text-[length:var(--fh)] font-semibold">
          {t(`${route.section}.title`)}
        </h2>
        <p className="text-sm text-muted-foreground">{t(`${route.section}.description`)}</p>
      </header>
      <View />
    </section>
  );
}
