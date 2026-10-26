import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { SaveBar, type SaveBarProps } from '@/components/settings/SaveBar';
import { confirmLeave, hasUnsavedChanges } from '@/components/settings/unsaved';

const U = en.settings.unsaved;

function bar(o: Partial<SaveBarProps> = {}) {
  const props: SaveBarProps = { dirty: false, pending: false, result: null, error: 'Could not save', saved: 'All saved', onDiscard: vi.fn(), ...o };
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  const view = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <form onSubmit={onSubmit}>
        <SaveBar {...props} />
      </form>
    </NextIntlClientProvider>,
  );
  return { props, onSubmit, view };
}

afterEach(() => vi.restoreAllMocks());

describe('SaveBar', () => {
  it('clean: Save is disabled, no Discard, no text', () => {
    bar();
    expect(screen.getByRole('button', { name: en.common.save })).toBeDisabled();
    expect(screen.queryByRole('button', { name: U.discard })).toBeNull();
    expect(screen.queryByText(U.bar)).toBeNull();
  });

  it('dirty: says so, Save submits the form, Discard calls back', async () => {
    const { props, onSubmit } = bar({ dirty: true });
    expect(screen.getByText(U.bar)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: en.common.save }));
    expect(onSubmit).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: U.discard }));
    expect(props.onDiscard).toHaveBeenCalledOnce();
  });

  it('a success is announced as status, an error as alert', () => {
    const { view } = bar({ result: 'saved' });
    expect(screen.getByRole('status')).toHaveTextContent('All saved');
    view.unmount();
    bar({ dirty: true, result: 'error' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
  });

  it('sticky at the bottom of the frame, above the safe area', () => {
    const { view } = bar({ dirty: true });
    const el = view.container.querySelector('form > div')!;
    for (const c of ['sticky', 'bottom-0', 'bg-card', 'border-t']) expect(el.classList.contains(c), c).toBe(true);
  });

  it('while dirty, reload asks (beforeunload) and confirmLeave asks; once clean, neither does', () => {
    function Harness() {
      const [dirty, setDirty] = useState(true);
      return (
        <NextIntlClientProvider locale="en" messages={en}>
          <form>
            <SaveBar dirty={dirty} pending={false} result={null} error="" saved="" onDiscard={() => setDirty(false)} />
          </form>
        </NextIntlClientProvider>
      );
    }
    render(<Harness />);
    expect(hasUnsavedChanges()).toBe(true);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(confirmLeave('leave?')).toBe(false);
    expect(confirm).toHaveBeenCalledWith('leave?');
  });

  it('nothing dirty: confirmLeave goes ahead without asking', async () => {
    const { view } = bar({ dirty: true });
    view.unmount();
    expect(hasUnsavedChanges()).toBe(false);
    const confirm = vi.spyOn(window, 'confirm');
    expect(confirmLeave('leave?')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
