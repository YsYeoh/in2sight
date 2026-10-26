'use client';

// The settings section list (Plan 16a): a vertical list of links from md up, one native select on phones (CSS
// breakpoints only). Both ask before leaving a section with unsaved changes (components/settings/unsaved.ts).
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { confirmLeave } from '@/components/settings/unsaved';
import { NavLink } from '@/components/shared/NavLink';
import { isActive } from '@/lib/nav';
import { DEFAULT_SECTION, SECTIONS, isSectionId, sectionHref } from '@/lib/settings/sections';

export function SettingsNav() {
  const t = useTranslations('settings.sections');
  const tu = useTranslations('settings.unsaved');
  const pathname = usePathname();
  const router = useRouter();
  const active = SECTIONS.find((s) => isActive(pathname, sectionHref(s.id)))?.id ?? DEFAULT_SECTION;
  return (
    <nav aria-label={t('nav')} className="min-w-0 md:sticky md:top-[var(--pg)]">
      <div className="flex flex-col gap-1.5 md:hidden">
        <label htmlFor="settings-section" className="text-sm font-medium">
          {t('pick')}
        </label>
        {/* controlled: a cancelled confirm leaves it on the current section */}
        <select
          id="settings-section"
          value={active}
          onChange={(e) => {
            const id = e.target.value;
            if (isSectionId(id) && confirmLeave(tu('confirm'))) router.push(sectionHref(id));
          }}
          className="h-[var(--ctl)] w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          {SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {t(`${s.id}.title`)}
            </option>
          ))}
        </select>
      </div>
      <ul className="hidden flex-col gap-1 md:flex">
        {SECTIONS.map(({ id, icon }) => (
          <li key={id}>
            <NavLink
              href={sectionHref(id)}
              icon={icon}
              iconClassName="size-4"
              aria-current={id === active ? 'page' : undefined}
              onClick={(e) => {
                if (id !== active && !confirmLeave(tu('confirm'))) e.preventDefault();
              }}
              className="flex h-[var(--ctl)] min-w-0 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-hover hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
            >
              <span className="truncate">{t(`${id}.title`)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
