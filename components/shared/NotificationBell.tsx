'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { alertHref, alertText, type KindTranslator } from '@/lib/alerts/message';
import type { NotificationItem } from '@/lib/alerts/read';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Result = { ok: boolean };

export interface NotificationBellProps {
  items: NotificationItem[];
  unread: number;
  markRead: (id: number) => Promise<Result>;
  markAllRead: () => Promise<Result>;
}

export function NotificationBell({ items, unread, markRead, markAllRead }: NotificationBellProps) {
  const t = useTranslations('notifications');
  const tk = useTranslations('notifications.kinds') as unknown as KindTranslator;
  const { prefs } = usePrefs();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  // ponytail: a failed mark-read just leaves the dot; the next action or page load shows the truth
  const select = (n: NotificationItem) => {
    setOpen(false);
    if (!n.readAt) start(async () => void (await markRead(n.id)));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('bell', { count: unread })} className="relative">
          <Bell aria-hidden />
          {unread > 0 ? (
            <span aria-hidden className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground">
              {unread > 99 ? '99+' : formatNumber(unread, prefs)}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      {/* announced when the count changes (after a sync or a mark-read) */}
      <span className="sr-only" aria-live="polite">
        {unread > 0 ? t('unread', { count: unread }) : ''}
      </span>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <Button variant="ghost" size="sm" disabled={unread === 0 || pending} onClick={() => start(async () => void (await markAllRead()))}>
            {t('markAll')}
          </Button>
        </div>
        {items.length === 0 ? (
          <EmptyState icon={<Bell aria-hidden className="size-5" />} title={t('empty')} description={t('emptyHint')} />
        ) : (
          <ul className="max-h-[min(70dvh,28rem)] overflow-y-auto">
            {items.map((n) => {
              const { title, body } = alertText(n.kind, n.payload, tk, prefs);
              return (
                <li key={n.id} className="border-b border-border last:border-b-0">
                  <Link href={alertHref(n.kind, n.accountId)} onClick={() => select(n)} className="flex gap-3 px-3 py-2.5 outline-none hover:bg-hover focus-visible:bg-hover">
                    <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium break-words">
                        {n.readAt ? null : <span className="sr-only">{t('unreadItem')}: </span>}
                        {title}
                      </span>
                      <span className="block text-xs break-words text-muted-foreground">{body}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{formatDateTime(n.createdAt, prefs)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
