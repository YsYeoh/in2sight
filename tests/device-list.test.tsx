import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { DeviceList, type DeviceListProps } from '@/components/settings/DeviceList';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { DEFAULT_PREFS } from '@/lib/prefs';

const M = en.settings.notifications;
const DEVICES = [
  { id: 7, label: 'Chrome · Windows', createdAt: '2026-10-12T08:00:00Z' },
  { id: 3, label: null, createdAt: '2026-10-01T08:00:00Z' },
];

function list(o: Partial<DeviceListProps> = {}) {
  const props: DeviceListProps = { devices: DEVICES, remove: vi.fn(async () => ({ ok: true })), ...o };
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PrefsProvider initial={DEFAULT_PREFS} persist={vi.fn()}>
        <DeviceList {...props} />
      </PrefsProvider>
    </NextIntlClientProvider>,
  );
  return props;
}

beforeEach(() => refresh.mockReset());

describe('DeviceList', () => {
  it('one row per device: its label (or Unknown device) and the date it was added', () => {
    list();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Chrome · Windows')).toBeInTheDocument();
    expect(within(items[0]).getByText('Added 12 Oct 2026')).toBeInTheDocument();
    expect(within(items[1]).getByText(M.devicesUnknown)).toBeInTheDocument();
    expect(screen.getByText(M.devicesHint)).toBeInTheDocument();
  });

  it('empty and failed reads say so (a failed read is not "no devices")', () => {
    list({ devices: [] });
    expect(screen.getByText(M.devicesEmpty)).toBeInTheDocument();
  });

  it('a failed read is an alert', () => {
    list({ devices: null });
    expect(screen.getByRole('alert')).toHaveTextContent(M.devicesLoadError);
  });

  it('Remove asks first, then removes by id and refreshes', async () => {
    const p = list();
    await userEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: M.devicesRemove }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Chrome · Windows?')).toBeInTheDocument();
    expect(p.remove).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: M.devicesRemove }));
    expect(p.remove).toHaveBeenCalledWith(7);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('a refused remove keeps the dialog open with the error', async () => {
    list({ remove: vi.fn(async () => ({ ok: false, error: 'unexpected' })) });
    await userEvent.click(within(screen.getAllByRole('listitem')[1]).getByRole('button', { name: M.devicesRemove }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: M.devicesRemove }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(M.devicesError);
    expect(refresh).not.toHaveBeenCalled();
  });
});
