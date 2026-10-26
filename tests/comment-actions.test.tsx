import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CommentActions, type CommentActionsProps } from '@/components/account/CommentActions';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', async (orig) => ({ ...(await orig<object>()), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh, prefetch: vi.fn(), back: vi.fn() }) }));

// jsdom lacks the pointer-capture / scroll APIs and ResizeObserver that Radix uses (same stubs as tests/followers-tab.test.tsx)
const DOM_STUBS = { hasPointerCapture: () => false, setPointerCapture: () => {}, releasePointerCapture: () => {}, scrollIntoView: () => {} };
const originals = Object.keys(DOM_STUBS).map((k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const);
beforeEach(() => {
  Object.assign(Element.prototype, DOM_STUBS);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  for (const [k, d] of originals) {
    if (d) Object.defineProperty(Element.prototype, k, d);
    else delete (Element.prototype as unknown as Record<string, unknown>)[k];
  }
});

const T = en.pages.account.moderation;
const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OK = { ok: true as const, logged: true };

function renderIt(o: Partial<CommentActionsProps> = {}) {
  const props: CommentActionsProps = { accountId: A, commentId: 'c1', authorUsername: 'fan', hidden: false, own: false, hide: vi.fn(async () => OK), reply: vi.fn(async () => OK), remove: vi.fn(async () => OK), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <CommentActions {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}
const menu = () => screen.getByRole('button', { name: T.menu });
async function pick(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(menu());
  await user.click(await screen.findByRole('menuitem', { name: new RegExp(`^${item}`) }));
}

describe('CommentActions', () => {
  it('hide: confirm, one request with a fresh id, announced, refreshed, focus back on the menu button', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.hide);
    expect(await screen.findByRole('alertdialog', { name: T.hideDialog.title })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: T.hideDialog.confirm }));
    await waitFor(() => expect(p.hide).toHaveBeenCalledTimes(1));
    expect(vi.mocked(p.hide).mock.calls[0].slice(0, 3)).toEqual([A, 'c1', true]);
    expect(vi.mocked(p.hide).mock.calls[0][3]).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent(T.done.hide);
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(menu()).toHaveFocus());
  });

  it('a hidden comment offers Unhide', async () => {
    const user = userEvent.setup();
    const p = renderIt({ hidden: true });
    await pick(user, T.unhide);
    await user.click(await screen.findByRole('button', { name: T.unhideDialog.confirm }));
    await waitFor(() => expect(vi.mocked(p.hide).mock.calls[0][2]).toBe(false));
  });

  it("the account's own comment: Hide is disabled and says why", async () => {
    const user = userEvent.setup();
    renderIt({ own: true });
    await user.click(menu());
    const item = await screen.findByRole('menuitem', { name: new RegExp(`^${T.hide}`) });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent(T.ownHint);
  });

  it('delete: says it cannot be undone and needs the typed word before the button works', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.delete);
    const dialog = await screen.findByRole('alertdialog', { name: T.deleteDialog.title });
    expect(dialog).toHaveTextContent('cannot be undone');
    const confirm = screen.getByRole('button', { name: T.deleteDialog.confirm });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(T.deleteDialog.word), T.deleteDialog.word);
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(p.remove).toHaveBeenCalledWith(A, 'c1', expect.stringMatching(UUID)));
  });

  it('reply: counts characters, refuses empty text, sends the text', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.reply);
    expect(await screen.findByRole('dialog', { name: 'Reply to @fan' })).toBeInTheDocument();
    const send = screen.getByRole('button', { name: T.replyDialog.send });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText(T.replyDialog.label), 'Thanks!');
    expect(screen.getByText('7 of 2,200 characters')).toBeInTheDocument();
    await user.click(send);
    await waitFor(() => expect(p.reply).toHaveBeenCalledWith(A, 'c1', 'Thanks!', expect.stringMatching(UUID)));
  });

  it('an error key is shown translated in the open dialog; nothing is refreshed', async () => {
    const user = userEvent.setup();
    renderIt({ hide: vi.fn(async () => ({ ok: false as const, error: 'rate_limited' as const })) });
    await pick(user, T.hide);
    await user.click(await screen.findByRole('button', { name: T.hideDialog.confirm }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.rate_limited);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a double click sends once; each new dialog is a new request id', async () => {
    const user = userEvent.setup();
    let resolve!: (v: typeof OK) => void;
    const hide = vi.fn<CommentActionsProps['hide']>(() => new Promise<typeof OK>((r) => (resolve = r)));
    renderIt({ hide });
    await pick(user, T.hide);
    const confirm = await screen.findByRole('button', { name: T.hideDialog.confirm });
    await user.dblClick(confirm);
    expect(hide).toHaveBeenCalledTimes(1);
    resolve(OK);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await pick(user, T.hide);
    await user.click(await screen.findByRole('button', { name: T.hideDialog.confirm }));
    await waitFor(() => expect(hide).toHaveBeenCalledTimes(2));
    expect(hide.mock.calls[1][3]).not.toBe(hide.mock.calls[0][3]);
  });

  it('Cancel closes without a request and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    const p = renderIt();
    await pick(user, T.hide);
    await user.click(await screen.findByRole('button', { name: T.cancel }));
    await waitFor(() => expect(menu()).toHaveFocus());
    expect(p.hide).not.toHaveBeenCalled();
  });
});
