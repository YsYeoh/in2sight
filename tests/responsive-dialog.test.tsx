import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/shared/ResponsiveDialog';
import en from '@/messages/en.json';

function Demo() {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      <ResponsiveDialog>
        <ResponsiveDialogTrigger>Open</ResponsiveDialogTrigger>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Add account</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Log in to Instagram</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <button>Continue</button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </NextIntlClientProvider>
  );
}

describe('ResponsiveDialog', () => {
  it('opens as an accessible dialog with title and description', async () => {
    render(<Demo />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog', { name: 'Add account' });
    expect(dialog).toHaveAccessibleDescription('Log in to Instagram');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('turns into a bottom sheet below md using CSS classes only', async () => {
    render(<Demo />);
    await userEvent.click(screen.getByText('Open'));
    const dialog = await screen.findByRole('dialog');
    const tokens = dialog.className.split(/\s+/);
    for (const cls of [
      'max-md:bottom-0',
      'max-md:top-auto',
      'max-md:translate-y-0',
      'max-md:rounded-b-none',
      'max-md:max-w-none',
      'sm:max-md:max-w-none', // 640-767px: beats sm:max-w-lg
      // zoom animation neutralised, slide up instead
      'max-md:data-[state=open]:zoom-in-100',
      'max-md:data-[state=closed]:zoom-out-100',
      'max-md:data-[state=open]:slide-in-from-bottom',
      'max-md:data-[state=closed]:slide-out-to-bottom',
    ]) {
      expect(tokens, cls).toContain(cls);
    }
  });

  it('closes with Escape', async () => {
    render(<Demo />);
    await userEvent.click(screen.getByText('Open'));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
