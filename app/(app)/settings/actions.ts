'use server';

import { revalidatePath } from 'next/cache';
import { parseAlertSettings, type AlertSettings } from '@/lib/alerts/settings';
import { confirmEnroll, disableFactor, startEnroll } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { clipUserAgent, parseEndpoint, parseSubscription } from '@/lib/push/subscription';
import { createServerSupabase } from '@/lib/supabase/server';

export async function startEnrollAction() {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await startEnroll(await createServerSupabase());
  return r.ok ? r : ({ ok: false, error: r.error } as const);
}

export async function confirmEnrollAction(factorId: string, code: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await confirmEnroll(await createServerSupabase(), { factorId: String(factorId), code: String(code) });
  if (r.ok) revalidatePath('/settings');
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

export async function disableAction(factorId: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await disableFactor(await createServerSupabase(), String(factorId));
  if (r.ok) revalidatePath('/settings');
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

// Push subscriptions and alert settings. OWNER-SESSION client: RLS (push_subscriptions_owner_all, profiles_owner_all)
// applies to every write. Never the admin client here. Errors are keys, never Supabase text.
export type PushResult = { ok: true } | { ok: false; error: 'invalid' | 'unexpected' };

export async function saveSubscriptionAction(subscription: unknown, userAgent: unknown): Promise<PushResult> {
  await requireOwner();
  const s = parseSubscription(subscription);
  if (!s) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('push_subscriptions').upsert({ endpoint: s.endpoint, keys: s.keys, user_agent: clipUserAgent(userAgent) }, { onConflict: 'endpoint' });
    return error ? { ok: false, error: 'unexpected' } : { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export async function deleteSubscriptionAction(endpoint: unknown): Promise<PushResult> {
  await requireOwner();
  const e = parseEndpoint(endpoint);
  if (!e) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('push_subscriptions').delete().eq('endpoint', e);
    return error ? { ok: false, error: 'unexpected' } : { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

/** Saves the normalised settings (unknown keys dropped, thresholds clamped) and returns what was stored. */
export async function saveAlertSettingsAction(raw: unknown): Promise<{ ok: true; settings: AlertSettings } | { ok: false; error: 'unexpected' }> {
  const { userId } = await requireOwner();
  const settings = parseAlertSettings(raw);
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('profiles').upsert({ user_id: userId, alert_settings: settings, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: 'unexpected' };
    revalidatePath('/settings');
    return { ok: true, settings };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
