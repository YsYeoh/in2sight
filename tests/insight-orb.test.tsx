import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { InsightOrb } from '@/components/shared/InsightOrb';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const wrap = (ui: React.ReactNode, messages: typeof en = en) =>
  render(
    <NextIntlClientProvider locale={messages === en ? 'en' : 'zh-CN'} messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('InsightOrb', () => {
  it.each([
    ['en', en],
    ['zh-CN', zh],
  ] as const)('is a polite status with a hidden, translated label (%s)', (_l, messages) => {
    wrap(<InsightOrb />, messages);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(messages.common.loading);
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('takes a custom label', () => {
    wrap(<InsightOrb label="Reading" />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading');
  });

  it.each([
    ['xs', 'size-4'],
    ['md', 'size-10'],
    ['lg', 'size-24'],
  ] as const)('size %s renders the %s box', (size, cls) => {
    const { container } = wrap(<InsightOrb size={size} />);
    const svg = container.querySelector('svg.insight-orb')!;
    expect(svg).toHaveAttribute('data-size', size);
    expect(svg).toHaveClass(cls);
  });

  it('decorative: no live region, only an aria-hidden svg (for buttons that set aria-busy themselves)', () => {
    const { container } = wrap(<InsightOrb size="xs" decorative className="extra" />);
    expect(screen.queryByRole('status')).toBeNull();
    const svg = container.firstElementChild!;
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('extra');
  });

  it('has three orbiting arcs and a self-drawing sparkline (the CSS hooks the keyframes use)', () => {
    const { container } = wrap(<InsightOrb />);
    expect(container.querySelectorAll('.orb-arc')).toHaveLength(3);
    expect(container.querySelector('.orb-spark')).not.toBeNull();
    expect(container.querySelector('.orb-halo')).not.toBeNull();
  });

  it('two orbs on one page get different gradient ids, each filled from its own', () => {
    const { container } = wrap(
      <>
        <InsightOrb />
        <InsightOrb />
      </>,
    );
    const ids = [...container.querySelectorAll('radialGradient')].map((g) => g.id);
    expect(new Set(ids).size).toBe(2);
    ids.forEach((id) => expect(id).toMatch(/^orb-[a-zA-Z0-9]+$/));
    const fills = [...container.querySelectorAll('circle[fill^="url"]')].map((c) => c.getAttribute('fill'));
    expect(fills).toEqual(ids.map((id) => `url(#${id})`));
  });

  it('lg with captions shows the three rotating captions (aria-hidden: the label is announced once)', () => {
    wrap(<InsightOrb size="lg" captions />);
    for (const k of ['caption1', 'caption2', 'caption3'] as const) {
      const el = screen.getByText(en.loading[k]);
      expect(el.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('uses theme tokens only: no hex / rgb / hsl colours in the component or its CSS', () => {
    for (const f of ['components/shared/InsightOrb.tsx', 'styles/loading.css']) {
      expect(read(f).replace(/\/\*[\s\S]*?\*\//g, ''), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    }
    const { container } = wrap(<InsightOrb />);
    const colours = [...container.innerHTML.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
    expect(new Set(colours)).toEqual(new Set(['--chart-1', '--chart-2', '--chart-3', '--surface']));
  });

  it('reduced motion: the CSS stops arcs, sparkline and the bar crawl, and leaves a slow pulse', () => {
    const css = read('styles/loading.css');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.insight-orb \.orb-arc[\s\S]*animation: none/);
    expect(block).toMatch(/\.insight-orb \.orb-spark \{\s*stroke-dashoffset: 0/);
    expect(block).toMatch(/\.insight-orb \{\s*animation: orb-pulse/);
    expect(block).toMatch(/\.nav-progress\[data-state="loading"\] \{\s*animation: none/);
  });

  it('the stylesheet is loaded globally', () => {
    expect(read('app/globals.css')).toContain('@import "../styles/loading.css";');
  });
});
