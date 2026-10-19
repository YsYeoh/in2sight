import { existsSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import { TabSkeleton } from '@/components/account/TabSkeleton';
import { TABS } from '@/lib/dashboard/account';

const APP = join(process.cwd(), 'app');
const files = (readdirSync(APP, { recursive: true }) as string[]).map((f) => f.replaceAll('\\', '/'));
const dirsWith = (name: string) => files.filter((f) => f === name || f.endsWith(`/${name}`)).map((f) => (f.includes('/') ? posix.dirname(f) : ''));

// Pages that need no skeleton: redirects, public entry pages, static shells and the dev gallery.
const NO_SKELETON = new Set(['', 'login', 'login/verify', 'setup', 'offline', 'styleguide', 'report/print']);
// A loading.tsx wraps every page BELOW it too. Only these nested pages may sit under someone else's skeleton.
const NESTED_OK = new Set(['report/print']); // static, renders nothing async: the boundary never shows

const pages = dirsWith('page.tsx');
const loaders = dirsWith('loading.tsx');

describe('every route segment has its own page-shaped loading.tsx', () => {
  it('finds the app pages (sanity)', () => {
    expect(pages).toEqual(expect.arrayContaining(['(app)/overview', '(app)/accounts/(list)', '(app)/accounts/[id]/(tabs)','(app)/calendar', '(app)/tags', '(app)/settings', 'report']));
  });

  it.each(pages.filter((p) => !NO_SKELETON.has(p)))('%s has a loading.tsx next to its page', (dir) => {
    expect(existsSync(join(APP, dir, 'loading.tsx'))).toBe(true);
  });

  it('no loading.tsx wraps another route page (e.g. accounts/loading.tsx would flash the list skeleton on /accounts/[id])', () => {
    for (const l of loaders) {
      const nested = pages.filter((p) => p !== l && p.startsWith(l === '' ? '' : `${l}/`) && !NESTED_OK.has(p));
      expect(nested, `${l}/loading.tsx wraps ${nested.join(', ')}`).toEqual([]);
    }
  });

  it.each(loaders)('%s/loading.tsx renders with exactly one status orb', async (dir) => {
    const { default: Loading } = (await import(/* @vite-ignore */ join(APP, dir, 'loading.tsx'))) as { default: () => React.ReactElement };
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <Loading />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe('account tab skeletons', () => {
  it.each(TABS)('%s: an aria-busy block of skeletons, no second orb', (tab) => {
    const { container } = render(<TabSkeleton tab={tab} />);
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
    expect(container.querySelector('svg.insight-orb')).toBeNull();
  });
});
