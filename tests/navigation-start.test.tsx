import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { AccountView } from '@/components/account/AccountView';
import { PostsTab } from '@/components/account/PostsTab';
import { CalendarView } from '@/components/calendar/CalendarView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { PROGRESS_START_EVENT } from '@/components/shared/NavigationProgress';
import { buildCalendar } from '@/lib/dashboard/calendar';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
const started = vi.fn();
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  started.mockReset();
  push.mockReset();
  window.addEventListener(PROGRESS_START_EVENT, started);
});
afterEach(() => {
  window.removeEventListener(PROGRESS_START_EVENT, started);
  vi.unstubAllGlobals();
});
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
const A1 = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';

describe('client navigations that are not link clicks start the top bar', () => {
  it('choosing an account tab starts the bar, then pushes ?tab=… with the time scope', async () => {
    const scope = resolveScope(parseTimeScope({ from: '90d' }), '2026-10-15', '2026-01-01');
    wrap(
      <AccountView account={{ id: A1, username: 'brand.one', displayName: null, groupName: null }} tab="overview" scope={scope} today="2026-10-15" keep={{ tab: 'overview' }}>
        <p>x</p>
      </AccountView>,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Stories' }));
    expect(started).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith('?tab=stories&from=90d', { scroll: false });
  });

  it('submitting the Posts filters starts the bar (next/form GET, no method attribute needed)', () => {
    const { container } = wrap(<PostsTab posts={[]} total={0} tags={[]} filters={{ format: 'REELS', tag: null, from: null, to: null }} setPostTags={vi.fn()} />);
    const form = container.querySelector('form')!;
    expect(form.method).toBe('get');
    fireEvent.submit(form);
    expect(started).toHaveBeenCalledOnce();
  });

  it('picking an account in the Calendar submits the GET form and starts the bar', () => {
    const scope = resolveScope(parseTimeScope({ month: '2026-10' }), '2026-10-15');
    const model = buildCalendar({ from: '2026-10-01', to: '2026-10-31' }, [], { weekStart: 'mon', tz: 'UTC', today: '2026-10-15' });
    wrap(<CalendarView model={model} scope={scope} today="2026-10-15" accounts={[{ id: A1, username: 'brand.one' }]} account={null} truncated={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: en.pages.calendar.account }), { target: { value: A1 } });
    expect(started).toHaveBeenCalledOnce();
  });
});
