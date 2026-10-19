import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { StoriesTab } from '@/components/account/StoriesTab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { buildStories } from '@/lib/dashboard/content';
import type { StoryRow } from '@/lib/dashboard/detail-read';
import { DEFAULT_PREFS } from '@/lib/prefs';

const NOW = new Date('2026-10-15T04:00:00Z'); // 12:00 in Kuala Lumpur (the default timezone)
const snap = (capturedAt: string, views: number) => ({ capturedAt, reach: views - 1, views, replies: 1, shares: 0, interactions: 2, tapsForward: 7, tapsBack: 0, exits: 2 });
const story = (id: string, postedAt: string, o: Partial<StoryRow> = {}): StoryRow => ({ id, postedAt, expiresAt: new Date(Date.parse(postedAt) + 86_400_000).toISOString(), permalink: null, snapshots: [snap(postedAt, 10), snap(new Date(Date.parse(postedAt) + 1_800_000).toISOString(), 20)], cover: 'ok', ...o });
// 15 Oct (KL): 07:30 then 09:00, both live; 13 Oct: one expired Story whose cover was never saved; 12 Oct: under 5 viewers
const STORIES = buildStories(
  [
    story('late', '2026-10-15T01:00:00Z'),
    story('early', '2026-10-14T23:30:00Z'),
    story('old', '2026-10-13T02:00:00Z', { cover: 'unavailable' }),
    story('few', '2026-10-12T02:00:00Z', { snapshots: [] }),
  ],
  NOW,
);

function strip(locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <StoriesTab stories={STORIES} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('Stories filmstrip', () => {
  it('one strip per owner-timezone day, newest day first; inside a day the Stories in the order they played', () => {
    strip();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['15 Oct 2026 · 2 Stories', '13 Oct 2026 · 1 Story', '12 Oct 2026 · 1 Story']);
    const today = screen.getByRole('region', { name: '15 Oct 2026 · 2 Stories' });
    expect(within(today).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Details of Story · 15 Oct 2026 07:30', 'Details of Story · 15 Oct 2026 09:00']);
    expect(within(today).getAllByText(en.pages.account.stories.live)).toHaveLength(2);
  });

  it('frames: the stored cover, or the placeholder and the Expired ribbon for a gone Story; numbers under each', () => {
    strip();
    const today = screen.getByRole('region', { name: '15 Oct 2026 · 2 Stories' });
    expect(within(today).getAllByRole('img', { name: 'Story' })[0]).toHaveAttribute('src', '/api/media/early/cover');
    const old = screen.getByRole('region', { name: '13 Oct 2026 · 1 Story' });
    expect(within(old).getByRole('img', { name: 'Story (no cover available)' })).toBeInTheDocument();
    expect(within(old).getByText(en.media.expired)).toBeInTheDocument();
    expect(within(old).getByText(en.pages.account.stories.exitRate).nextSibling).toHaveTextContent('10.0%'); // 2 exits ÷ 20 views
    expect(within(screen.getByRole('region', { name: '12 Oct 2026 · 1 Story' })).getByText(en.analysis.reasons.needs_5_viewers)).toBeInTheDocument();
  });

  it('a frame opens the Story drawer with all numbers and the views curve; Esc returns focus to the frame', async () => {
    const user = userEvent.setup();
    strip();
    const trigger = screen.getByRole('button', { name: 'Details of Story · 15 Oct 2026 09:00' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Story · 15 Oct 2026 09:00' });
    expect(dialog).toHaveAccessibleDescription('2 snapshots so far');
    expect(within(dialog).getByText(en.pages.account.stories.tapsForward).nextSibling).toHaveTextContent('7');
    expect(dialog.querySelector('[data-slot="sparkline"]')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('a Story Instagram never measured: the drawer explains why and shows no numbers', async () => {
    const user = userEvent.setup();
    strip();
    await user.click(screen.getByRole('button', { name: 'Details of Story · 12 Oct 2026 10:00' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(en.analysis.reasons.needs_5_viewers);
    expect(dialog.querySelector('dl')).toBeNull();
  });

  it('zh-CN day headings', () => {
    strip('zh-CN');
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('2 条快拍');
  });
});
