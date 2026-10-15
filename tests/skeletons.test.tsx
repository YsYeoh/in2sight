import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { RouteLoading, SkeletonGrid, SkeletonHeader, SkeletonTable, SkeletonTabs } from '@/components/shared/Skeletons';
import { Skeleton } from '@/components/ui/skeleton';

const wrap = (ui: React.ReactNode, messages: typeof en = en) =>
  render(
    <NextIntlClientProvider locale={messages === en ? 'en' : 'zh-CN'} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
const blocks = (el: ParentNode) => el.querySelectorAll('[data-slot="skeleton"]');

describe('skeleton kit', () => {
  it('the base Skeleton pulses only when motion is allowed', () => {
    const { container } = render(<Skeleton />);
    const cls = container.firstElementChild!.className;
    expect(cls).toContain('motion-safe:animate-pulse');
    expect(cls.split(' ')).not.toContain('animate-pulse');
  });

  it('SkeletonHeader: title + subtitle, plus one block per action', () => {
    const { container } = wrap(<SkeletonHeader actions={2} />);
    expect(blocks(container)).toHaveLength(4);
  });

  it('SkeletonGrid: count blocks, with the page grid columns and item height passed through', () => {
    const { container } = wrap(<SkeletonGrid count={4} className="grid-cols-2 lg:grid-cols-4" itemClassName="h-56" />);
    expect(container.firstElementChild).toHaveClass('grid', 'grid-cols-2', 'lg:grid-cols-4');
    expect(blocks(container)).toHaveLength(4);
    expect(blocks(container)[0]).toHaveClass('h-56');
  });

  it('SkeletonTable: header + rows at the density row height', () => {
    const { container } = wrap(<SkeletonTable rows={3} />);
    expect(blocks(container)).toHaveLength(4);
    expect(blocks(container)[1]).toHaveClass('h-[var(--row)]');
  });

  it('SkeletonTabs: one block per tab', () => {
    const { container } = wrap(<SkeletonTabs count={4} />);
    expect(blocks(container)).toHaveLength(4);
  });

  it.each([
    ['en', en],
    ['zh-CN', zh],
  ] as const)('RouteLoading (%s): aria-busy frame, one status orb with the caption, the children', (_l, messages) => {
    const { container } = wrap(
      <RouteLoading>
        <p>shape</p>
      </RouteLoading>,
      messages,
    );
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(messages.loading.caption1);
    expect(screen.getByText('shape')).toBeInTheDocument();
    expect(container.querySelector('svg.insight-orb')).toHaveAttribute('data-size', 'md');
  });
});
