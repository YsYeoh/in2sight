import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { DEFAULT_SECTION, SECTION_IDS, SECTIONS, isSectionId, routeSettings, sectionHref } from '@/lib/settings/sections';
import { isTabPath } from '@/lib/tabs/model';

describe('settings sections registry', () => {
  it('six sections in this order, each with an icon and a title + description in both languages', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['appearance', 'language', 'notifications', 'accounts', 'security', 'data']);
    expect(SECTIONS.map((s) => s.id)).toEqual([...SECTION_IDS]);
    for (const s of SECTIONS) {
      expect(s.icon).toBeTruthy();
      for (const m of [en, zh]) {
        expect(m.settings.sections[s.id].title, s.id).toBeTruthy();
        expect(m.settings.sections[s.id].description, s.id).toBeTruthy();
      }
    }
    expect(DEFAULT_SECTION).toBe('appearance');
  });

  it('isSectionId accepts the ids only', () => {
    expect(isSectionId('security')).toBe(true);
    for (const v of ['', 'Security', 'general', 'constructor', null, 1]) expect(isSectionId(v)).toBe(false);
  });

  it('every section URL stays inside its shell tab (never breaks out of the frame)', () => {
    for (const id of SECTION_IDS) {
      expect(sectionHref(id)).toBe(`/settings/${id}`);
      expect(isTabPath(sectionHref(id))).toBe(true);
    }
  });
});

describe('routeSettings', () => {
  it('/settings redirects to the first section', () => {
    expect(routeSettings(undefined, undefined)).toEqual({ redirect: '/settings/appearance' });
    expect(routeSettings([], undefined)).toEqual({ redirect: '/settings/appearance' });
  });

  it('the old tab names redirect to their new sections; anything else to the first', () => {
    expect(routeSettings(undefined, 'general')).toEqual({ redirect: '/settings/appearance' });
    expect(routeSettings(undefined, 'notifications')).toEqual({ redirect: '/settings/notifications' });
    expect(routeSettings(undefined, 'account')).toEqual({ redirect: '/settings/security' });
    expect(routeSettings(undefined, 'toString')).toEqual({ redirect: '/settings/appearance' });
    expect(routeSettings(undefined, 'bogus')).toEqual({ redirect: '/settings/appearance' });
  });

  it('a known section renders it (a ?tab= there is ignored)', () => {
    expect(routeSettings(['language'], undefined)).toEqual({ section: 'language' });
    expect(routeSettings(['security'], 'general')).toEqual({ section: 'security' });
  });

  it('an unknown or deeper path is not found', () => {
    expect(routeSettings(['bogus'], undefined)).toBeNull();
    expect(routeSettings(['appearance', 'x'], undefined)).toBeNull();
    expect(routeSettings(['Appearance'], undefined)).toBeNull();
  });
});
