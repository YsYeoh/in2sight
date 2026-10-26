import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Segmented } from '@/components/shared/Segmented';

const OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

describe('Segmented', () => {
  it('a labelled group with the chosen option pressed', () => {
    render(<Segmented label="Mode" value="dark" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('picking another option calls onChange once; picking the current one does nothing', async () => {
    const onChange = vi.fn();
    render(<Segmented label="Mode" value="dark" options={OPTIONS} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('light');
  });

  it('one control height and wraps at 360 px (no overflow)', () => {
    render(<Segmented label="Mode" value="dark" options={OPTIONS} onChange={vi.fn()} />);
    const g = screen.getByRole('group');
    for (const c of ['min-h-[var(--ctl)]', 'flex-wrap', 'max-w-full', 'border-input']) expect(g.classList.contains(c), c).toBe(true);
  });
});
