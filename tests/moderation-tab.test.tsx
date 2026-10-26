import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
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

import { ModerationTab, type ModerationActions, type ModerationTabProps } from '@/components/account/ModerationTab';
import type { ModerationData } from '@/lib/moderation/store';

const T = en.pages.account.moderation;
const A = '7b0c7c2e-4f7a-4b8e-9a37-0e5d1b2c3d4e';
const RULE = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const word = { id: RULE, kind: 'word' as const, pattern: 'spam', wholeWord: false };

const DATA = (o: Partial<ModerationData> = {}): ModerationData => ({
  settings: { autoHide: false, pausedAt: null, pauseReason: null },
  rules: [word],
  log: {
    rows: [
      { id: 1, commentId: 'c1', action: 'hide', actor: `rule:${RULE}`, result: 'ok', targetId: null, undoOf: null, createdAt: '2026-10-29T09:00:00Z', undoneAt: null, shown: 'ok', undo: 'unhide', context: { authorUsername: 'bot', snippet: 'buy spam' } },
      { id: 2, commentId: 'c2', action: 'reply', actor: 'owner', result: 'pending', targetId: null, undoOf: null, createdAt: '2026-10-29T08:00:00Z', undoneAt: null, shown: 'unknown', undo: null, context: null },
      { id: 3, commentId: 'c3', action: 'hide', actor: 'rule:00000000-0000-4000-8000-000000000000', result: 'rate_limited', targetId: null, undoOf: null, createdAt: '2026-10-29T07:00:00Z', undoneAt: null, shown: 'rate_limited', undo: null, context: null },
    ],
    total: 120,
    page: 1,
    pages: 3,
    size: 50,
  },
  preview: { count: 2, scanned: 40, sample: [{ id: 'c9', authorUsername: 'bot2', snippet: 'spam again', rule: word }] },
  ...o,
});

function renderTab(o: Partial<ModerationTabProps> = {}) {
  const ok = async () => ({ ok: true as const });
  const actions: ModerationActions = { saveWord: vi.fn(ok), setSpam: vi.fn(ok), deleteRule: vi.fn(ok), setAutoHide: vi.fn(ok), undo: vi.fn(async () => ({ ok: true as const, logged: true })) };
  const props: ModerationTabProps = { accountId: A, allowed: true, data: DATA(), scope: { from: '2026-10-01' }, actions, ...o };
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <ModerationTab {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return { ...view, actions: props.actions };
}

describe('ModerationTab', () => {
  it('without the comments scope: only the reconnect explanation with a link to Accounts', () => {
    renderTab({ allowed: false });
    expect(screen.getByText(T.noScope.title)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: T.noScope.link })).toHaveAttribute('href', '/accounts');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('before the migration: the database-update note', () => {
    renderTab({ data: null });
    expect(screen.getByText(T.notReady.title)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('switching auto-hide on shows the preview count in a confirm; only the confirm enables it', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab();
    await user.click(screen.getByRole('switch', { name: T.auto.switch }));
    const dialog = await screen.findByRole('alertdialog', { name: T.auto.enableTitle });
    expect(dialog).toHaveTextContent('2 comments that are already here will be hidden.');
    expect(actions.setAutoHide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: T.auto.enableConfirm }));
    await waitFor(() => expect(actions.setAutoHide).toHaveBeenCalledWith(A, true));
  });

  it('switching it off needs no confirm', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab({ data: DATA({ settings: { autoHide: true, pausedAt: null, pauseReason: null } }) });
    await user.click(screen.getByRole('switch', { name: T.auto.switch }));
    await waitFor(() => expect(actions.setAutoHide).toHaveBeenCalledWith(A, false));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('no rules: the switch is disabled with a hint; a pause shows its reason', () => {
    renderTab({ data: DATA({ rules: [], preview: { count: 0, scanned: 0, sample: [] } }) });
    expect(screen.getByRole('switch', { name: T.auto.switch })).toBeDisabled();
    expect(screen.getAllByText(T.auto.noRules).length).toBeGreaterThan(0);
  });

  it('a paused auto-hide explains why and reads as off', () => {
    renderTab({ data: DATA({ settings: { autoHide: true, pausedAt: '2026-10-29T06:00:00Z', pauseReason: 'reconnect' } }) });
    expect(screen.getByText(new RegExp(T.auto.pausedReconnect.slice(0, 30)))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: T.auto.switch })).not.toBeChecked();
  });

  it('the preview lists matches with their rule', () => {
    renderTab();
    expect(screen.getByText('2 visible comments match your rules.')).toBeInTheDocument();
    expect(screen.getByText('Checked against the newest 40 stored comments.')).toBeInTheDocument();
    expect(screen.getByText('spam again')).toBeInTheDocument();
    expect(screen.getAllByText('Matches: “spam”').length).toBe(1);
  });

  it('rules: add a whole-word word, remove one, switch a spam pattern; error keys are translated', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab();
    await user.type(screen.getByLabelText(T.rules.wordLabel), 'cheap');
    await user.click(screen.getByRole('checkbox', { name: T.rules.wholeWord }));
    await user.click(screen.getByRole('button', { name: T.rules.add }));
    await waitFor(() => expect(actions.saveWord).toHaveBeenCalledWith(A, 'cheap', true));
    await user.click(screen.getByRole('button', { name: 'Remove spam' }));
    await waitFor(() => expect(actions.deleteRule).toHaveBeenCalledWith(A, RULE));
    await user.click(screen.getByRole('switch', { name: T.rules.link.label }));
    await waitFor(() => expect(actions.setSpam).toHaveBeenCalledWith(A, 'link', true));
    vi.mocked(actions.saveWord).mockResolvedValueOnce({ ok: false, error: 'duplicate_rule' });
    await user.type(screen.getByLabelText(T.rules.wordLabel), 'spam');
    await user.click(screen.getByRole('button', { name: T.rules.add }));
    expect(await screen.findByRole('alert')).toHaveTextContent(T.errors.duplicate_rule);
  });

  it('the log: who, what, result, context; unknown outcomes and removed rules are named', () => {
    renderTab();
    expect(screen.getByText(T.log.title)).toBeInTheDocument();
    expect(screen.getAllByText('By rule: “spam”', { exact: false }).length).toBe(1);
    expect(screen.getByText(new RegExp(`${T.log.byOwner}.*${T.log.results.unknown}`))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`By rule: ${T.ruleLabel.removed}.*${T.errors.rate_limited.slice(0, 20)}`))).toBeInTheDocument();
    expect(screen.getByText('@bot: buy spam')).toBeInTheDocument();
    expect(screen.getAllByText(T.log.gone)).toHaveLength(2);
    expect(screen.getByText('1–50 of 120')).toBeInTheDocument();
  });

  it('undo: confirm, then one call with the row id and a fresh request id', async () => {
    const user = userEvent.setup();
    const { actions } = renderTab();
    await user.click(screen.getByRole('button', { name: T.log.undo.unhide }));
    await screen.findByRole('alertdialog', { name: T.log.undoTitle.unhide });
    await user.dblClick(screen.getAllByRole('button', { name: T.log.undo.unhide }).at(-1)!);
    await waitFor(() => expect(actions.undo).toHaveBeenCalledTimes(1));
    expect(vi.mocked(actions.undo).mock.calls[0].slice(0, 2)).toEqual([A, 1]);
    expect(vi.mocked(actions.undo).mock.calls[0][2]).toMatch(UUID);
  });

  it('page links keep the Time Scope and the tab', () => {
    const { container } = renderTab();
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('?tab=moderation&from=2026-10-01&page=2');
  });
});
