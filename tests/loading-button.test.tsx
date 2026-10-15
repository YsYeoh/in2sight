import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { LoginForm } from '@/components/auth/LoginForm';
import { LoadingButton } from '@/components/shared/LoadingButton';

const wrap = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );

describe('LoadingButton', () => {
  it('idle: an enabled button, no orb, no aria-busy', () => {
    wrap(<LoadingButton>Save</LoadingButton>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeEnabled();
    expect(b).not.toHaveAttribute('aria-busy');
    expect(b.querySelector('svg.insight-orb')).toBeNull();
  });

  it('pending: disabled, aria-busy, decorative xs orb before the label (no nested live region)', () => {
    wrap(<LoadingButton pending>Save</LoadingButton>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    const orb = b.querySelector('svg.insight-orb')!;
    expect(orb).toHaveAttribute('data-size', 'xs');
    expect(orb).toHaveAttribute('aria-hidden', 'true');
    expect(b.firstElementChild).toBe(orb);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps its own disabled reason when not pending', () => {
    wrap(<LoadingButton disabled>Save</LoadingButton>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy');
  });

  it('passes Button props through (variant, size, onClick)', async () => {
    const onClick = vi.fn();
    wrap(
      <LoadingButton variant="outline" size="sm" onClick={onClick}>
        Go
      </LoadingButton>,
    );
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b).toHaveAttribute('data-variant', 'outline');
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is adopted by the login form: submitting shows the orb + "Signing in" until the action returns', async () => {
    let release: (v: object) => void = () => {};
    const action = vi.fn(() => new Promise<object>((r) => (release = r)));
    wrap(<LoginForm action={action} />);
    await userEvent.click(screen.getByRole('button', { name: en.auth.login.submit }));
    const b = await screen.findByRole('button', { name: en.auth.login.submitting });
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b.querySelector('svg.insight-orb')).not.toBeNull();
    release({});
    expect(await screen.findByRole('button', { name: en.auth.login.submit })).not.toHaveAttribute('aria-busy');
  });
});
