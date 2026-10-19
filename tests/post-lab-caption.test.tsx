import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CaptionLab } from '@/components/post-lab/CaptionLab';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { captionLab } from '@/lib/analysis/caption';
import { DEFAULT_PREFS } from '@/lib/prefs';

const view = (lab: ReturnType<typeof captionLab>) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <CaptionLab lab={lab} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );

describe('CaptionLab', () => {
  it('the caption’s features and hashtags; below 20 measured posts no comparison, with the count', () => {
    view(captionLab('Which one? Save it for later #summer #ootd', [{ caption: 'x', reach: 10 }]));
    expect(screen.getByRole('heading', { name: 'Caption lab' })).toBeInTheDocument();
    expect(screen.getByText('Asks a question').nextSibling).toHaveTextContent('Yes');
    expect(screen.getByText('Call to action').nextSibling).toHaveTextContent('save');
    expect(within(screen.getByRole('list', { name: 'Hashtags' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['#summer', '#ootd']);
    expect(screen.getByText('The comparison needs 20 measured posts of this format; there are 1 so far.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('from 20 measured posts: median reach with vs without each trait, and that it is a pattern, not a cause', () => {
    const peers = [...Array.from({ length: 12 }, (_, i) => ({ caption: `Which one do you like best for summer? ${i}`, reach: 1000 })), ...Array.from({ length: 8 }, () => ({ caption: 'hi', reach: 400 }))];
    view(captionLab('Is this the one?', peers));
    const table = within(screen.getByRole('table'));
    expect(table.getByRole('row', { name: /A question/ })).toHaveTextContent('A questionYes1,000 (n = 12)400 (n = 8)');
    expect(table.getByRole('row', { name: /Hashtags/ })).toHaveTextContent('HashtagsNotoo few (0)1,000 (n = 20)');
    expect(screen.getByText(/A pattern in your own last 20 measured posts of this format, not a cause/)).toBeInTheDocument();
  });
});
