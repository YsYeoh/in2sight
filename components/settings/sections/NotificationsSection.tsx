import { deleteDeviceAction, deleteSubscriptionAction, saveAlertSettingsAction, saveSubscriptionAction, sendTestPushAction } from '@/app/(app)/settings/actions';
import { AlertSettingsForm } from '@/components/settings/AlertSettingsForm';
import { DeviceList } from '@/components/settings/DeviceList';
import { NotificationsCard } from '@/components/settings/NotificationsCard';
import { parseAlertSettings } from '@/lib/alerts/settings';
import { requireOwner } from '@/lib/auth/require-owner';
import { listPushDevices } from '@/lib/push/devices';
import { createServerSupabase } from '@/lib/supabase/server';

/** Settings -> Notifications (Plan 16a): this device, the alert rules, the devices. Owner session only (RLS). */
export async function NotificationsSection() {
  const { userId } = await requireOwner();
  const db = await createServerSupabase();
  const [profile, devices] = await Promise.all([db.from('profiles').select('alert_settings').eq('user_id', userId).maybeSingle(), listPushDevices(db)]);
  const alertSettings = parseAlertSettings(profile.error ? null : profile.data?.alert_settings);
  // only the PUBLIC VAPID key reaches the browser, as a prop (the private key stays in lib/push/send.ts)
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
  return (
    <div className="grid gap-[var(--gp)]">
      <NotificationsCard vapidPublicKey={vapidPublicKey} swEnabled={process.env.NODE_ENV === 'production'} save={saveSubscriptionAction} remove={deleteSubscriptionAction} test={sendTestPushAction} />
      <AlertSettingsForm initial={alertSettings} save={saveAlertSettingsAction} />
      <DeviceList devices={devices} remove={deleteDeviceAction} />
    </div>
  );
}
