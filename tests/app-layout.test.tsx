import { Suspense, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/auth/require-owner', () => ({ requireOwner: async () => (calls.push('owner'), { userId: 'u1', email: 'a@b.c' }) }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: async () => ({}) }));
vi.mock('@/lib/alerts/read', () => ({ loadNotifications: async () => (calls.push('notifications'), { items: [], unread: 3 }) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => `loading.${key}` }));
vi.mock('@/app/login/actions', () => ({ signOutAction: vi.fn() }));
vi.mock('@/app/(app)/notifications/actions', () => ({ markReadAction: vi.fn(), markAllReadAction: vi.fn() }));

import AppLayout from '@/app/(app)/layout';

type Bell = ReactElement<{ fallback: ReactElement; children: ReactElement<Record<string, unknown>> }>;
const layout = () => AppLayout({ children: <p>page</p> }) as Promise<ReactElement<{ userEmail: string; bell: Bell }>>;

beforeEach(() => {
  calls.length = 0;
});

describe('(app) layout', () => {
  it('does not wait for the notifications: the owner check only, the bell is a Suspense island', async () => {
    const el = await layout();
    expect(calls).toEqual(['owner']);
    expect(el.props.userEmail).toBe('a@b.c');
    expect(el.props.bell.type).toBe(Suspense);
  });

  it('the bell fallback is an announced skeleton of the bell button size', async () => {
    const el = await layout();
    render(el.props.bell.props.fallback);
    expect(screen.getByRole('status')).toHaveTextContent('loading.notifications');
    expect(document.querySelector('[data-slot="skeleton"]')).toHaveClass('size-[var(--ctl)]');
  });

  it('the island loads the notifications and renders the bell with them', async () => {
    const el = await layout();
    const island = el.props.bell.props.children;
    const bell = (await (island.type as (p: object) => Promise<ReactElement<{ unread: number }>>)(island.props)) as ReactElement<{ unread: number }>;
    expect(calls).toEqual(['owner', 'notifications']);
    expect(bell.props.unread).toBe(3);
  });
});
