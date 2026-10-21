import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/login' }));
const frame = vi.hoisted(() => ({ on: true }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/tabs/protocol', async (orig) => ({ ...(await orig<typeof import('@/lib/tabs/protocol')>()), isFramed: () => frame.on }));

import { FrameBreakout, shouldBreakOut } from '@/components/shared/FrameBreakout';

describe('FrameBreakout', () => {
  it.each([
    ['/login', true],
    ['/login/verify', true],
    ['/setup', true],
    ['/auth/signout', true],
    ['/report', true],
    ['/report/print', true],
    ['/styleguide', true],
    ['/', true],
    ['/overview', false],
    ['/accounts/7b0c/media/1', false],
    ['/settings', false],
  ])('framed %s → breaks out: %s', (path, out) => {
    expect(shouldBreakOut(path, true)).toBe(out);
    expect(shouldBreakOut(path, false)).toBe(false); // the top window never navigates itself
  });

  it('a framed login page replaces the TOP window with its own URL', () => {
    const replace = vi.fn();
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({ location: { replace } } as unknown as Window);
    nav.pathname = '/login';
    frame.on = true;
    render(<FrameBreakout />);
    expect(replace).toHaveBeenCalledWith(window.location.href);
    replace.mockClear();
    frame.on = false;
    render(<FrameBreakout />);
    expect(replace).not.toHaveBeenCalled();
    top.mockRestore();
  });
});
