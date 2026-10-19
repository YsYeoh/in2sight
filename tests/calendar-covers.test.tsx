import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CalendarView, COVER_WEEKS } from '@/components/calendar/CalendarView';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildCalendar } from '@/lib/dashboard/calendar';
import type { MonthMedia } from '@/lib/dashboard/detail-read';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { parseTimeScope, resolveScope } from '@/lib/time-scope/scope';

const A1 = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const KL = { weekStart: 'mon' as const, tz: 'Asia/Kuala_Lumpur', today: '2026-10-15' };
const m = (id: string, postedAt: string, o: Partial<MonthMedia> = {}): MonthMedia => ({ id, accountId: A1, mediaType: 'IMAGE', postedAt, permalink: null, caption: `Caption ${id}`, cover: 'ok', slides: null, ...o });
// 15 Oct (KL): 4 items, one of them a Story whose cover was never saved; 2 Oct: one carousel
const MEDIA = [m('p1', '2026-10-15T01:00:00Z'), m('p2', '2026-10-15T02:00:00Z'), m('s1', '2026-10-15T03:00:00Z', { mediaType: 'STORY', cover: 'unavailable', caption: null }), m('p3', '2026-10-15T04:00:00Z'), m('c1', '2026-10-02T04:00:00Z', { mediaType: 'CAROUSEL_ALBUM', slides: 4 })];

function view(range: { from: string; to: string }, q: string) {
  const scope = resolveScope(parseTimeScope(new URLSearchParams(q)), KL.today, '2025-01-01');
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <CalendarView model={buildCalendar(range, MEDIA, KL)} scope={scope} today={KL.today} accounts={[{ id: A1, username: 'brand' }]} account={A1} truncated={false} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const thumbs = (el: Element) => [...el.querySelectorAll('[data-slot="media-thumb"]')];

describe('Calendar covers', () => {
  it('month view: up to 3 covers per day cell, stored ones from the owner-only route, the rest as placeholders', () => {
    view({ from: '2026-10-01', to: '2026-10-31' }, 'month=2026-10');
    const table = screen.getByRole('table');
    const cell = within(table).getByRole('button', { name: /^15 Oct 2026: 3 posts, 1 story/ });
    expect(thumbs(cell)).toHaveLength(3); // p1, p2, s1 (oldest first); p3 is counted, not shown
    expect([...cell.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/api/media/p1/cover', '/api/media/p2/cover']);
    expect(cell).toHaveClass('h-28');
    expect(thumbs(within(table).getByRole('button', { name: /^2 Oct 2026: 1 post/ }))).toHaveLength(1);
    expect(thumbs(within(table).getByRole('button', { name: /^14 Oct 2026: 0 posts/ }))).toHaveLength(0);
  });

  it('the day list shows a decorative cover next to each item (the text names it)', () => {
    view({ from: '2026-10-01', to: '2026-10-31' }, 'month=2026-10');
    const list = screen.getAllByText('Caption p1')[0].closest('ul')!; // today's list under the grid
    const covers = thumbs(list);
    expect(covers).toHaveLength(4);
    for (const c of covers) expect(c.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it(`a year grid (more than ${COVER_WEEKS} weeks) keeps the count chips only; the day list still has covers`, () => {
    view({ from: '2025-10-16', to: '2026-10-15' }, 'from=1y');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(COVER_WEEKS + 1);
    expect(thumbs(table)).toHaveLength(0);
    expect(within(table).getByRole('button', { name: /^15 Oct 2026: 3 posts, 1 story/ })).toHaveClass('h-20');
    expect(thumbs(screen.getAllByText('Caption p1')[0].closest('ul')!)).toHaveLength(4);
  });
});
