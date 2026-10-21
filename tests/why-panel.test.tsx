import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { WhyPanel } from '@/components/account/WhyPanel';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import type { DayPost, GrowthDay, UnusualDay } from '@/lib/analysis/why';
import { DEFAULT_PREFS } from '@/lib/prefs';
import { addDays } from '@/lib/sync/time';

const DAY = '2026-10-14'; // a Wednesday
const day = (d: string, o: Partial<GrowthDay> = {}): GrowthDay => ({ day: d, followers: null, follows: null, unfollows: null, net: 5, netSource: 'instagram', reach: 1000, reachFollower: 700, reachNonFollower: 300, storyReach: 400, posts: [], stories: 2, comments: 1, ...o });
const post = (id: string, d: string, o: Partial<DayPost> = {}): DayPost => ({ id, mediaType: 'REELS', postedAt: `${d}T12:00:00Z`, hour: 20, reach: 1000, permalink: null, ...o });
/** As tests/analysis-why.test.ts: 44 days, a Reel and an image every second day up to DAY − 2; DAY is a spike with a big Reel. */
const days: GrowthDay[] = Array.from({ length: 44 }, (_, i) => {
  const d = addDays(DAY, i - 43);
  if (d === DAY) return day(d, { net: 60, reachFollower: 800, reachNonFollower: 1200, posts: [post('big', DAY, { reach: 5000, permalink: 'https://www.instagram.com/reel/big/' })] });
  return day(d, { posts: i % 2 === 0 && d < addDays(DAY, -1) ? [post(`r${i}`, d), post(`i${i}`, d, { mediaType: 'IMAGE', reach: 400, hour: 9 })] : [] });
});
const unusual: UnusualDay[] = [{ day: DAY, metric: 'net', value: 60, typical: 5, z: null, direction: 'up' }];

function wrap(ui: ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('WhyPanel', () => {
  it('lists unusual days with the full weekday; picking one calls onPick (the keyboard path of the chart click)', async () => {
    const onPick = vi.fn();
    wrap(<WhyPanel days={days} unusual={unusual} pick={{ day: null, metric: 'net' }} onPick={onPick} />);
    expect(screen.getByRole('heading', { name: en.pages.account.growth.why.title })).toBeInTheDocument();
    const item = screen.getByRole('button', { name: /Wednesday/ });
    expect(item).toHaveAttribute('aria-pressed', 'false');
    expect(item.textContent).toContain('+60');
    expect(screen.getByText(en.pages.account.growth.why.pick)).toBeInTheDocument();
    await userEvent.setup().click(item);
    expect(onPick).toHaveBeenCalledWith(DAY, 'net');
  });

  it('the picked day: headline with typical and n, reasons with their basis, the posts with safe Instagram links', () => {
    wrap(<WhyPanel days={days} unusual={unusual} pick={{ day: DAY, metric: 'net' }} onPick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Wednesday/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Net follows on .*: \+60, typical \+5 \(median of 28 earlier days\)/)).toBeInTheDocument();
    const reasons = document.querySelectorAll('[data-reason]');
    expect([...reasons].map((r) => r.getAttribute('data-reason'))).toEqual(['posted', 'non_followers', 'time_of_day']);
    expect(reasons[0].textContent).toContain('Reel posted that day at');
    expect(reasons[0].textContent).toContain('5× your typical Reel');
    expect(reasons[0].textContent).toContain('Medium confidence · sample 21');
    expect(reasons[1].textContent).toContain('Non-followers were 60.0% of reach, typical 30.0%');
    const link = within(screen.getByText(en.pages.account.growth.why.posts).parentElement!).getByRole('link');
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/reel/big/');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('a post younger than a week says it is too recent to compare, with no multiple of the typical post (en and zh-CN)', () => {
    const { unmount } = wrap(<WhyPanel days={days} unusual={unusual} pick={{ day: DAY, metric: 'net' }} settled={addDays(DAY, 1)} onPick={vi.fn()} />);
    const posted = document.querySelector('[data-reason="posted"]')!;
    expect(posted.textContent).toContain('too recent to compare');
    expect(posted.textContent).not.toContain('×');
    expect(document.querySelector('[data-reason="time_of_day"]')).toBeNull();
    unmount();
    wrap(<WhyPanel days={days} unusual={unusual} pick={{ day: DAY, metric: 'net' }} settled={addDays(DAY, 1)} onPick={vi.fn()} />, 'zh-CN');
    expect(document.querySelector('[data-reason="posted"]')!.textContent).toContain('太新');
    expect(document.body.textContent).not.toMatch(/NaN|undefined|pages\.account|\{/);
  });

  it('nothing unusual, a day without enough history, a day without a value', () => {
    const { unmount } = wrap(<WhyPanel days={days.slice(-3)} unusual={[]} pick={{ day: DAY, metric: 'reach' }} onPick={vi.fn()} />);
    expect(screen.getByText(en.pages.account.growth.why.noUnusual)).toBeInTheDocument();
    expect(screen.getByText(/Not enough earlier days/)).toBeInTheDocument();
    unmount();
    wrap(<WhyPanel days={[day(DAY, { reach: null })]} unusual={[]} pick={{ day: DAY, metric: 'reach' }} onPick={vi.fn()} />);
    expect(screen.getByText(/No Reach figure for/)).toBeInTheDocument();
  });

  it('zh-CN: every text resolves (no raw keys, NaN or undefined)', () => {
    const { container } = wrap(<WhyPanel days={days} unusual={unusual} pick={{ day: DAY, metric: 'net' }} onPick={vi.fn()} />, 'zh-CN');
    expect(container.textContent).toContain(zh.pages.account.growth.why.title);
    expect(container.textContent).toContain('星期三');
    expect(container.textContent).not.toMatch(/NaN|undefined|pages\.account|\{/);
  });
});
