import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import en from '@/messages/en.json';
import zh from '@/messages/zh-CN.json';

function open(locale: string, messages: typeof en) {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Dialog open>
        <DialogContent>
          <DialogTitle>T</DialogTitle>
          <DialogDescription>D</DialogDescription>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </NextIntlClientProvider>,
  );
}

describe('Dialog close buttons are translated', () => {
  it.each([
    ['en', en, 'Close'],
    ['zh-CN', zh, '关闭'],
  ] as const)('$0: both close buttons are named by common.close', (locale, messages, label) => {
    open(locale, messages as typeof en);
    expect(screen.getAllByRole('button', { name: label })).toHaveLength(2);
  });
});
