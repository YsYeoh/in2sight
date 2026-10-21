import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ConnectDialog } from '@/components/accounts/ConnectDialog';

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

const open = async (props: Partial<React.ComponentProps<typeof ConnectDialog>> = {}) => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConnectDialog groups={['Brand X', 'Personal']} trigger={<button>Open</button>} {...props} />
    </NextIntlClientProvider>,
  );
  await userEvent.click(screen.getByText('Open'));
  return screen.findByRole('dialog');
};

describe('ConnectDialog', () => {
  it('without a group the continue link goes straight to the connect route', async () => {
    await open();
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('href', '/api/instagram/connect');
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('target', '_top'); // inside a tab frame: Instagram cannot be framed
  });

  it('a typed group is URL-encoded into the link', async () => {
    await open();
    await userEvent.type(screen.getByLabelText('Group (optional)'), 'Brand & Co');
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('href', '/api/instagram/connect?group=Brand%20%26%20Co');
  });

  it('offers the existing groups as suggestions', async () => {
    await open();
    const list = document.getElementById(screen.getByLabelText('Group (optional)').getAttribute('list')!)!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['Brand X', 'Personal']);
  });

  it('caps the group at 40 characters', async () => {
    await open();
    expect(screen.getByLabelText('Group (optional)')).toHaveAttribute('maxlength', '40');
  });

  it('explains the requirements', async () => {
    await open();
    expect(screen.getByText(/Creator or Business accounts only/)).toBeInTheDocument();
  });

  it('a whitespace-only group is treated as no group', async () => {
    await open();
    await userEvent.type(screen.getByLabelText('Group (optional)'), '   ');
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toHaveAttribute('href', '/api/instagram/connect');
  });

  it('disables Continue when the group has control characters, instead of silently dropping it', async () => {
    await open();
    const input = screen.getByLabelText('Group (optional)');
    fireEvent.change(input, { target: { value: 'BrandX' } });
    const cont = screen.getByText('Continue with Instagram');
    expect(screen.queryByRole('link', { name: 'Continue with Instagram' })).not.toBeInTheDocument();
    expect(cont.closest('button')).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Brand X' } });
    expect(screen.getByRole('link', { name: 'Continue with Instagram' })).toBeInTheDocument();
  });
});
