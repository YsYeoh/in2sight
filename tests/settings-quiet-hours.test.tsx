import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertSettingsForm } from '@/components/settings/AlertSettingsForm';
import { DEFAULT_ALERT_SETTINGS, parseAlertSettings } from '@/lib/alerts/settings';
import en from '@/messages/en.json';

// jsdom has no ResizeObserver (the sticky SaveBar observes its size)
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

const M = en.settings.notifications;
const K = en.notifications.kinds;

function form(hourLabels?: string[]) {
  const save = vi.fn(async (raw: unknown) => ({ ok: true as const, settings: parseAlertSettings(raw) }));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AlertSettingsForm initial={DEFAULT_ALERT_SETTINGS} save={save} hourLabels={hourLabels} />
    </NextIntlClientProvider>,
  );
  return save;
}

describe('AlertSettingsForm: quiet hours and summaries (Plan 17e)', () => {
  it('two labelled hour selects (22:00 and 08:00 by default) and a hint naming the summary time', () => {
    form();
    expect(screen.getByRole('group', { name: M.quietTitle })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: M.quietFrom })).toHaveValue('22');
    expect(screen.getByRole('combobox', { name: M.quietTo })).toHaveValue('8');
    expect(screen.getAllByRole('option', { name: '22:00' })).toHaveLength(2);
    expect(screen.getByText(/arrive as one summary at 08:00\./)).toBeInTheDocument();
  });

  it("hour labels come from the server in the owner's time format", () => {
    form(Array.from({ length: 24 }, (_, h) => `h${h}`));
    expect(screen.getByRole('combobox', { name: M.quietTo })).toHaveDisplayValue('h8');
    expect(screen.getByText(/one summary at h8\./)).toBeInTheDocument();
  });

  it('changing an hour makes the form dirty and Save sends both hours as numbers', async () => {
    const save = form();
    const button = screen.getByRole('button', { name: en.common.save });
    expect(button).toBeDisabled();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: M.quietTo }), '7');
    expect(screen.getByText(/one summary at 07:00\./)).toBeInTheDocument();
    await userEvent.click(button);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ quietFrom: 22, quietTo: 7 }));
    expect(await screen.findByRole('status')).toHaveTextContent(M.saved);
    expect(button).toBeDisabled();
  });

  it('switches for the summaries and the non-follower spike; none for the unfollow spike while its rule is off', () => {
    form();
    expect(screen.getByRole('switch', { name: K.digest.title })).toBeChecked();
    expect(screen.getByRole('switch', { name: K.weekly_digest.title })).toBeChecked();
    expect(screen.getByRole('switch', { name: K.nonfollower_spike.title })).toBeChecked();
    expect(screen.queryByRole('switch', { name: K.unfollow_spike.title })).toBeNull();
  });
});
