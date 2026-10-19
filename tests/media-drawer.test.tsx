import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { MediaDrawer } from '@/components/shared/MediaDrawer';
import type { ThumbMedia } from '@/components/shared/MediaThumb';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const MEDIA: ThumbMedia = { id: '1789', mediaType: 'CAROUSEL_ALBUM', cover: 'ok', caption: 'Launch day', slides: 5 };

function drawer(o: { permalink?: string | null; action?: React.ReactNode; children?: React.ReactNode } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <MediaDrawer
          media={MEDIA}
          title="Carousel · 7 Oct 2026 20:00"
          description="Launch day"
          permalink={o.permalink === undefined ? 'https://www.instagram.com/p/x/' : o.permalink}
          stats={[
            { label: 'Reach', value: '1.2K' },
            { label: 'Engagement rate', value: '4.1%' },
          ]}
          trigger={<button type="button">Open details</button>}
          action={o.action}
        >
          {o.children}
        </MediaDrawer>
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

describe('MediaDrawer', () => {
  it('keyboard: Enter on the trigger opens it, Esc closes it and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    drawer();
    expect(screen.queryByRole('dialog')).toBeNull(); // nothing mounted until opened
    await user.tab();
    const trigger = screen.getByRole('button', { name: 'Open details' });
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Carousel · 7 Oct 2026 20:00' });
    expect(dialog).toHaveAccessibleDescription('Launch day');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('shows the cover, slide count, key numbers, the extra sections, the action slot and the Instagram link', async () => {
    const user = userEvent.setup();
    drawer({ action: <a href="/lab">Open Post Lab</a>, children: <p>Tags go here</p> });
    await user.click(screen.getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('img', { name: 'Launch day' })).toHaveAttribute('src', '/api/media/1789/cover');
    expect(within(dialog).getByText('5 slides')).toBeInTheDocument();
    expect(within(dialog).getByText('Reach').nextSibling).toHaveTextContent('1.2K');
    expect(within(dialog).getByText('Tags go here')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open Post Lab' })).toHaveAttribute('href', '/lab');
    const ig = within(dialog).getByRole('link', { name: en.media.open });
    expect(ig).toHaveAttribute('href', 'https://www.instagram.com/p/x/');
    expect(ig).toHaveAttribute('target', '_blank');
    expect(ig).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('no permalink and no action: no link row', async () => {
    const user = userEvent.setup();
    drawer({ permalink: null });
    await user.click(screen.getByRole('button', { name: 'Open details' }));
    expect(within(await screen.findByRole('dialog')).queryAllByRole('link')).toHaveLength(0);
  });
});
