// In-memory AlertStore for the alert runner and tick tests. insertNew behaves like ON CONFLICT DO NOTHING RETURNING.
import { vi } from 'vitest';
import type { DailyRow, Post } from '@/lib/analysis/types';
import type { Alert } from '@/lib/alerts/rules';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/alerts/settings';
import type { AlertStore } from '@/lib/alerts/store';
import { DEFAULT_PREFS, type Locale, type Prefs } from '@/lib/prefs';
import type { PushSub } from '@/lib/push/send';

export interface AlertMemInit {
  settings?: AlertSettings;
  locale?: Locale;
  prefs?: Partial<Prefs>;
  daily?: Record<string, DailyRow[]>;
  posts?: Record<string, Post[]>;
  subs?: PushSub[];
}

export const pushSub = (n: number): PushSub => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } });

export function memoryAlertStore(init: AlertMemInit = {}) {
  const rows: (Alert & { createdAt: string })[] = [];
  let subs = [...(init.subs ?? [])];
  const store: AlertStore = {
    context: vi.fn(async () => ({ settings: init.settings ?? DEFAULT_ALERT_SETTINGS, prefs: { ...DEFAULT_PREFS, ...init.prefs, locale: init.locale ?? init.prefs?.locale ?? 'en' } })),
    daily: vi.fn(async (id: string) => init.daily?.[id] ?? []),
    posts: vi.fn(async (id: string) => init.posts?.[id] ?? []),
    lastReachDropAt: vi.fn(async (id: string) => rows.filter((r) => r.accountId === id && r.kind === 'reach_drop').at(-1)?.createdAt ?? null),
    insertNew: vi.fn(async (alerts: Alert[]) => {
      const fresh = alerts.filter((a) => !rows.some((r) => r.dedupeKey === a.dedupeKey));
      rows.push(...fresh.map((a) => ({ ...a, createdAt: '2026-10-14T02:00:00.000Z' })));
      return fresh;
    }),
    subscriptions: vi.fn(async () => [...subs]),
    deleteSubscription: vi.fn(async (endpoint: string) => {
      subs = subs.filter((s) => s.endpoint !== endpoint);
    }),
  };
  return { store, rows, subs: () => subs };
}
