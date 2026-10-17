import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { SavedViews, type SavedViewsProps } from '@/components/explorer/SavedViews';

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses; patch them for this file only
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const V1 = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const ok = async () => ({ ok: true as const });

function view(o: Partial<SavedViewsProps> = {}) {
  const props: SavedViewsProps = { views: [{ id: V1, name: 'Reels by hour', href: '/explorer?m=likes&by=hour' }], query: 'm=posts&by=format&from=90d', save: vi.fn(ok), rename: vi.fn(ok), remove: vi.fn(ok), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SavedViews {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe('SavedViews', () => {
  it('lists the views as links; empty list explains what a view is', () => {
    view();
    expect(screen.getByRole('link', { name: 'Reels by hour' })).toHaveAttribute('href', '/explorer?m=likes&by=hour');
    expect(screen.getByRole('button', { name: 'Rename Reels by hour' })).toBeInTheDocument();
    view({ views: [] });
    expect(screen.getByText(/No saved views yet/)).toBeInTheDocument();
  });

  it('save: asks for a name and sends it with the current query; an error key is shown translated', async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: 'duplicate' }).mockResolvedValueOnce({ ok: true });
    view({ save });
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = screen.getByRole('dialog', { name: 'Save this view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Top formats');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('Top formats', 'm=posts&by=format&from=90d');
    expect(await within(dialog).findByText('A view with this name already exists.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()); // the transition has ended
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('rename starts from the current name; delete asks first and sends the id', async () => {
    const user = userEvent.setup();
    const p = view();
    await user.click(screen.getByRole('button', { name: 'Rename Reels by hour' }));
    const dialog = screen.getByRole('dialog', { name: 'Rename view' });
    const input = within(dialog).getByLabelText('Name');
    expect(input).toHaveValue('Reels by hour');
    await user.clear(input);
    await user.type(input, 'Reels per hour');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(p.rename).toHaveBeenCalledWith(V1, 'Reels per hour');
    await user.click(screen.getByRole('button', { name: 'Delete Reels by hour' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent('Delete “Reels by hour”?');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(p.remove).toHaveBeenCalledWith(V1);
  });
});
