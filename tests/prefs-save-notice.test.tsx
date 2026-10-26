import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { PrefsProvider, usePrefs } from '@/components/providers/PrefsProvider';
import { PREFS_TOAST_ID, PrefsSaveNotice } from '@/components/providers/PrefsSaveNotice';
import { DEFAULT_PREFS } from '@/lib/prefs';

function Probe() {
  const { update } = usePrefs();
  return <button onClick={() => update({ theme: 'forest' })}>forest</button>;
}

function setup(persist: (p: unknown) => unknown) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={persist as never}>
        <Probe />
        <PrefsSaveNotice />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('PrefsSaveNotice', () => {
  it('nothing on first render (status idle)', () => {
    setup(vi.fn());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a saved change shows one short "Saved" toast with the fixed id', async () => {
    setup(vi.fn(async () => ({ ok: true })));
    await userEvent.click(screen.getByText('forest'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(en.settings.prefsSave.saved, { id: PREFS_TOAST_ID, duration: 2000 }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a failed save shows a lasting error with Retry, and Retry saves again', async () => {
    const persist = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    setup(persist);
    await userEvent.click(screen.getByText('forest'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [text, opts] = toast.error.mock.calls[0] as [string, { id: string; duration: number; action: { label: string; onClick: () => void } }];
    expect(text).toBe(en.settings.prefsSave.error);
    expect(opts).toMatchObject({ id: PREFS_TOAST_ID, duration: Infinity, action: { label: en.settings.prefsSave.retry } });
    opts.action.onClick();
    await waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(persist).toHaveBeenLastCalledWith({ theme: 'forest' });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
