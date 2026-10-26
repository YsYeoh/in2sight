import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => (calls.push('owner'), { userId: 'u1', email: 'o@x.y' }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = (await import('@/messages/en.json')).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) };
});
// each section is its own unit (its own test file); here they are stand-ins that name themselves
vi.mock('@/components/settings/sections/AppearanceSection', () => ({ AppearanceSection: () => <p>view:appearance</p> }));
vi.mock('@/components/settings/sections/LanguageSection', () => ({ LanguageSection: () => <p>view:language</p> }));
vi.mock('@/components/settings/sections/NotificationsSection', () => ({ NotificationsSection: () => <p>view:notifications</p> }));
vi.mock('@/components/settings/sections/AccountsSection', () => ({ AccountsSection: () => <p>view:accounts</p> }));
vi.mock('@/components/settings/sections/SecuritySection', () => ({ SecuritySection: () => <p>view:security</p> }));
vi.mock('@/components/settings/sections/DataSection', () => ({ DataSection: () => <p>view:data</p> }));

import SettingsSectionPage, { maxDuration } from '@/app/(app)/settings/[[...section]]/page';
import { SECTION_IDS } from '@/lib/settings/sections';

const page = (section: string[] | undefined, sp: Record<string, string> = {}) => SettingsSectionPage({ params: Promise.resolve({ section }), searchParams: Promise.resolve(sp) });

beforeEach(() => {
  calls.length = 0;
});

describe('/settings/[[...section]]', () => {
  it('checks the owner before anything else', async () => {
    await expect(page(undefined)).rejects.toThrow('REDIRECT:/settings/appearance');
    expect(calls).toEqual(['owner']);
  });

  it('/settings and the old tab names redirect; unknown and deeper paths are not found', async () => {
    await expect(page(undefined, { tab: 'account' })).rejects.toThrow('REDIRECT:/settings/security');
    await expect(page(undefined, { tab: 'notifications' })).rejects.toThrow('REDIRECT:/settings/notifications');
    await expect(page(['bogus'])).rejects.toThrow('NOT_FOUND');
    await expect(page(['security', 'x'])).rejects.toThrow('NOT_FOUND');
  });

  it.each(SECTION_IDS)('/settings/%s renders its heading, description and its own component', async (id) => {
    render(await page([id]));
    expect(screen.getByRole('heading', { level: 2, name: en.settings.sections[id].title })).toBeInTheDocument();
    expect(screen.getByText(en.settings.sections[id].description)).toBeInTheDocument();
    expect(screen.getByText(`view:${id}`)).toBeInTheDocument();
  });

  it('allows a 60 s server action (Sync now runs a tick)', () => {
    expect(maxDuration).toBe(60);
  });

  it('the section contract: components/settings/sections/<Id>Section.tsx exports <Id>Section with no props', () => {
    for (const id of SECTION_IDS) {
      const name = `${id[0].toUpperCase()}${id.slice(1)}Section`;
      const src = readFileSync(join(process.cwd(), 'components/settings/sections', `${name}.tsx`), 'utf8');
      expect(src, name).toMatch(new RegExp(`export (async )?function ${name}\\(\\)`));
    }
  });
});
