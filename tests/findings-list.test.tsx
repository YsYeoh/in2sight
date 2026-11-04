import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { FindingsList } from '@/components/shared/FindingsList';
import type { Finding } from '@/lib/analysis/insights';
import { DEFAULT_PREFS } from '@/lib/prefs';

const A = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
const f = (kind: Finding['kind'], params: Finding['params'], x: Partial<Finding> = {}): Finding => ({ key: `${kind}:${A}:1`, accountId: A, kind, tone: 'tip', params, n: 9, confidence: 'medium', day: '2026-10-14', postId: null, href: `/accounts/${A}`, ...x });
const ALL: Finding[] = [
  f('reach_drop', { change: -0.25 }, { key: 'k1', tone: 'bad' }),
  f('posting_gap', { days: 6, typical: 2.5 }, { key: 'k2', tone: 'bad' }),
  f('unanswered', { count: 3 }, { key: 'k3', tone: 'bad' }),
  f('unusual_day', { metric: 'followers', value: -39, typical: 1, weekday: 3 }, { key: 'k4', tone: 'bad' }),
  f('breakout', { ratio: 2.06, format: 'REELS' }, { key: 'k5', tone: 'good' }),
  f('best_slot', { weekday: 2, daypart: 'evening', ratio: 2.1 }, { key: 'k6' }),
  f('format_winner', { format: 'CAROUSEL_ALBUM', ratio: 1.4 }, { key: 'k7' }),
  f('hashtag_winner', { hashtag: '美食', ratio: 3 }, { key: 'k8' }),
];

function wrap(ui: React.ReactNode, locale: 'en' | 'zh-CN' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        {ui}
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('FindingsList', () => {
  it('every kind in words, with its basis (n, a confidence word, the day) and a link to the evidence', () => {
    wrap(<FindingsList items={ALL} canDismiss={false} />);
    for (const s of [
      'Reach -25.0% over the last 7 days vs the 7 days before',
      'No post for 6 days; you usually post every 2.5 days',
      '3 questions in the last 7 days without a reply we can see',
      'Follower change on 14 Oct 2026: -39, usually +1 on a Wednesday',
      'A Reel posted 14 Oct 2026 has 2.1× the median reach of your previous posts',
      'Posts on Tuesday evening reach 2.1× the median of your other posts',
      'Carousel posts reach 1.4× the median of your other posts',
      'Posts with #美食 reach 3× the median of posts without it',
    ])
      expect(screen.getByText(s)).toBeInTheDocument();
    expect(screen.getAllByText('n = 9 · Medium confidence · 14 Oct 2026')).toHaveLength(8);
    expect(screen.getAllByRole('link', { name: en.insights.open })[0]).toHaveAttribute('href', `/accounts/${A}`);
    expect(screen.queryByRole('button')).toBeNull(); // no table: no dismiss
    expect(screen.getByText(en.insights.needsUpdate)).toBeInTheDocument();
  });

  it('dismiss and snooze call the action with the key; the line leaves the list; an error is announced', async () => {
    const user = userEvent.setup();
    const dismiss = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'needs_update' });
    wrap(<FindingsList items={ALL.slice(0, 2)} canDismiss dismiss={dismiss} />);
    await user.click(screen.getByRole('button', { name: `Dismiss: ${'Reach -25.0% over the last 7 days vs the 7 days before'}` }));
    expect(dismiss).toHaveBeenCalledWith('k1', 'dismiss');
    expect(await screen.findByRole('status')).toHaveTextContent(en.insights.hidden);
    expect(screen.queryByText('Reach -25.0% over the last 7 days vs the 7 days before')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Hide for 7 days: No post/ }));
    expect(dismiss).toHaveBeenLastCalledWith('k2', 'snooze');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.insights.errors.needs_update);
    expect(screen.getByText(/No post for 6 days/)).toBeInTheDocument(); // still there
  });

  it('empty list says so; zh-CN renders without NaN or raw keys', () => {
    wrap(<FindingsList items={[]} canDismiss />);
    expect(screen.getByText(en.insights.empty)).toBeInTheDocument();
    const { container } = wrap(<FindingsList items={ALL} canDismiss={false} />, 'zh-CN');
    expect(container.textContent).not.toMatch(/NaN|undefined|insights\./);
    expect(screen.getByText('星期二晚上发布的帖子覆盖人数是其他帖子中位数的 2.1 倍')).toBeInTheDocument();
  });
});
