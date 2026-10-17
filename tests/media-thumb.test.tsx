import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';
import { coverSrc, MediaThumb, type ThumbMedia } from '@/components/shared/MediaThumb';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

function thumb(media: ThumbMedia, o: { className?: string; badges?: boolean; locale?: 'en' | 'zh-CN' } = {}) {
  const locale = o.locale ?? 'en';
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh}>
      <PrefsProvider initial={{ ...DEFAULT_PREFS, locale }} persist={vi.fn()}>
        <MediaThumb media={media} className={o.className} badges={o.badges} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}
const box = (c: HTMLElement) => c.querySelector('[data-slot="media-thumb"]')!;

describe('MediaThumb', () => {
  it('a stored cover: the owner-only route, lazy, alt = caption snippet; skeleton until it loads, then shown', () => {
    const { container } = thumb({ id: '1789', mediaType: 'IMAGE', cover: 'ok', caption: 'Launch day' });
    const img = screen.getByRole('img', { name: 'Launch day' });
    expect(img).toHaveAttribute('src', '/api/media/1789/cover');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveClass('opacity-0');
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    fireEvent.load(img);
    expect(img).toHaveClass('opacity-100');
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('a load error swaps in the placeholder: never a broken image', () => {
    const { container } = thumb({ id: '1789', mediaType: 'REELS', cover: 'ok', caption: null });
    fireEvent.error(screen.getByRole('img', { name: 'Reel' }));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Reel (cover could not be loaded)' })).toBeInTheDocument();
  });

  it.each([
    ['pending', 'cover not saved yet'],
    ['unavailable', 'no cover available'],
    ['failed', 'cover could not be saved'],
    [undefined, 'cover not saved yet'],
  ] as const)('requests the cover route only when the status is ok (%s: placeholder, no request)', (cover, why) => {
    const { container } = thumb({ id: '5', mediaType: 'STORY', cover, caption: null });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: `Story (${why})` })).toBeInTheDocument();
  });

  it('aspect follows the format (4:5 image, 9:16 Reel/Story, 1:1 carousel); a caller class overrides it', () => {
    const cases = [
      ['IMAGE', 'aspect-[4/5]'],
      ['REELS', 'aspect-[9/16]'],
      ['STORY', 'aspect-[9/16]'],
      ['CAROUSEL_ALBUM', 'aspect-square'],
    ] as const;
    for (const [mediaType, aspect] of cases) {
      const { container, unmount } = thumb({ id: '1', mediaType, cover: 'pending' });
      expect(box(container)).toHaveClass(aspect);
      unmount();
    }
    const { container } = thumb({ id: '1', mediaType: 'IMAGE', cover: 'pending' }, { className: 'aspect-square w-9' });
    expect(box(container)).toHaveClass('aspect-square', 'w-9');
    expect(box(container)).not.toHaveClass('aspect-[4/5]');
  });

  it('badges: slide count on carousels, play glyph on Reels, the Expired ribbon; all off with badges={false}', () => {
    const carousel = thumb({ id: '1', mediaType: 'CAROUSEL_ALBUM', cover: 'ok', slides: 5 });
    expect(screen.getByText('5').closest('[aria-hidden="true"]')).not.toBeNull(); // decorative: the drawer says it in words
    carousel.unmount();
    const reel = thumb({ id: '2', mediaType: 'REELS', cover: 'ok' });
    expect(reel.container.querySelectorAll('[aria-hidden="true"] svg').length).toBeGreaterThanOrEqual(2); // format icon + play
    reel.unmount();
    const story = thumb({ id: '3', mediaType: 'STORY', cover: 'unavailable', expired: true });
    expect(screen.getByText(en.media.expired)).toBeInTheDocument(); // real text: it is a state, not decoration
    story.unmount();
    const off = thumb({ id: '4', mediaType: 'CAROUSEL_ALBUM', cover: 'ok', slides: 5, expired: true }, { badges: false });
    expect(off.container.querySelectorAll('span[aria-hidden="true"] svg')).toHaveLength(0); // no format icon, slide count or play glyph
    expect(off.container).not.toHaveTextContent('5');
    expect(screen.queryByText(en.media.expired)).toBeNull();
  });

  it('zh-CN placeholder label uses the Chinese format name and full-width brackets', () => {
    thumb({ id: '1', mediaType: 'IMAGE', cover: 'failed' }, { locale: 'zh-CN' });
    expect(screen.getByRole('img', { name: `${zh.analysis.format.IMAGE}（${zh.media.cover.failed}）` })).toBeInTheDocument();
  });

  it('the route path is built from an encoded id', () => {
    expect(coverSrc('17/../x')).toBe('/api/media/17%2F..%2Fx/cover');
  });
});
