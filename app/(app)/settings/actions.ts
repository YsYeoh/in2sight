'use server';

import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { parseAlertSettings, type AlertSettings } from '@/lib/alerts/settings';
import { confirmEnroll, disableFactor, startEnroll } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { sendToAll, vapidFromEnv, webPushTransport, type PushSub } from '@/lib/push/send';
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
  if (r.ok) revalidatePath('/settings', 'layout'); // every section page
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

export async function disableAction(factorId: string) {
  await requireOwner(); // server actions are public endpoints: authorize here, not only in the page
  const r = await disableFactor(await createServerSupabase(), String(factorId));
  if (r.ok) revalidatePath('/settings', 'layout'); // every section page
  return r.ok ? ({ ok: true } as const) : ({ ok: false, error: r.error } as const);
}

// Push subscriptions and alert settings. OWNER-SESSION client: RLS (push_subscriptions_owner_all, profiles_owner_all)
// applies to every write. Never the admin client here. Errors are keys, never Supabase text.
const MAX_SUBSCRIPTIONS = 20; // a single owner has a handful of devices; the cap bounds what a hostile session could store
export type PushResult = { ok: true } | { ok: false; error: 'invalid' | 'unexpected' };

export async function saveSubscriptionAction(subscription: unknown, userAgent: unknown): Promise<PushResult> {
  await requireOwner();
  const s = parseSubscription(subscription);
  if (!s) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const existing = await db.from('push_subscriptions').select('endpoint').limit(MAX_SUBSCRIPTIONS + 1);
    if (existing.error) return { ok: false, error: 'unexpected' };
    const have = (existing.data ?? []) as { endpoint: string }[];
    if (have.length >= MAX_SUBSCRIPTIONS && !have.some((r) => r.endpoint === s.endpoint)) return { ok: false, error: 'invalid' };
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
    revalidatePath('/settings', 'layout'); // every section page
    return { ok: true, settings };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

/** Settings -> Notifications -> Devices: removes one stored subscription by its id (the list never carries endpoints). */
export async function deleteDeviceAction(id: unknown): Promise<PushResult> {
  await requireOwner();
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'invalid' };
  try {
    const db = await createServerSupabase();
    const { error } = await db.from('push_subscriptions').delete().eq('id', id);
    if (error) return { ok: false, error: 'unexpected' };
    revalidatePath('/settings', 'layout');
    return { ok: true };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}

export type TestPushResult = { ok: true } | { ok: false; error: 'invalid' | 'not_configured' | 'gone' | 'failed' | 'unexpected' };

/**
 * "Send a test notification": ONE push to THIS device only. The browser passes its own endpoint; the server sends only
 * if that endpoint is stored for the owner (RLS), so it cannot be used to push to an arbitrary URL. A 404/410 from the
 * push service prunes the row (as the alert sender does). The text is in the owner's language (request locale).
 */
export async function sendTestPushAction(endpoint: unknown): Promise<TestPushResult> {
  await requireOwner();
  const e = parseEndpoint(endpoint);
  if (!e) return { ok: false, error: 'invalid' };
  const vapid = vapidFromEnv();
  if (!vapid) return { ok: false, error: 'not_configured' };
  try {
    const db = await createServerSupabase();
    const { data, error } = await db.from('push_subscriptions').select('endpoint,keys').eq('endpoint', e).maybeSingle();
    if (error) return { ok: false, error: 'unexpected' };
    if (!data) return { ok: false, error: 'invalid' };
    const t = await getTranslations('settings.notifications');
    const msg = { title: t('testTitle'), body: t('testBody'), url: '/settings/notifications', tag: 'test' };
    const r = await sendToAll([data as PushSub], msg, webPushTransport(vapid), async (gone) => {
      await db.from('push_subscriptions').delete().eq('endpoint', gone);
    });
    if (r.sent === 1) return { ok: true };
    return { ok: false, error: r.pruned === 1 ? 'gone' : 'failed' };
  } catch {
    return { ok: false, error: 'unexpected' };
  }
}
