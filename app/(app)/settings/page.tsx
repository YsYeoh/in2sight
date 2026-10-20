import { getTranslations } from 'next-intl/server';
import { AlertSettingsForm } from '@/components/settings/AlertSettingsForm';
import { NotificationsCard } from '@/components/settings/NotificationsCard';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { PrefsBar } from '@/components/shared/PrefsBar';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseAlertSettings } from '@/lib/alerts/settings';
import { getMfaStatus } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { confirmEnrollAction, deleteSubscriptionAction, disableAction, saveAlertSettingsAction, saveSubscriptionAction, startEnrollAction } from './actions';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const { userId, email } = await requireOwner(); // layouts don't re-run on client navigation, so the page checks too (and needs the email)
  const db = await createServerSupabase();
  const [status, profile] = await Promise.all([getMfaStatus(db), db.from('profiles').select('alert_settings').eq('user_id', userId).maybeSingle()]);
  const alertSettings = parseAlertSettings(profile.error ? null : profile.data?.alert_settings);
  // only the PUBLIC VAPID key reaches the browser, as a prop (the private key stays in lib/push/send.ts)
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || null;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs defaultValue="general">
        <TabsList variant="line">
          <TabsTrigger value="general" className="flex-none">{t('tabs.general')}</TabsTrigger>
          <TabsTrigger value="notifications" className="flex-none">{t('tabs.notifications')}</TabsTrigger>
          <TabsTrigger value="account" className="flex-none">{t('tabs.account')}</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <PrefsBar />
        </TabsContent>
        <TabsContent value="notifications" className="flex flex-col gap-[var(--gp)]">
          <NotificationsCard vapidPublicKey={vapidPublicKey} swEnabled={process.env.NODE_ENV === 'production'} save={saveSubscriptionAction} remove={deleteSubscriptionAction} />
          <AlertSettingsForm initial={alertSettings} save={saveAlertSettingsAction} />
        </TabsContent>
        <TabsContent value="account" className="flex flex-col gap-[var(--gp)]">
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('account.email')}</p>
              <p className="font-medium break-all">{email}</p>
            </CardContent>
          </Card>
          <TwoFactorCard
            enrolled={status.enrolled && status.factorId ? { factorId: status.factorId } : null}
            startEnrollAction={startEnrollAction}
            confirmEnrollAction={confirmEnrollAction}
            disableAction={disableAction}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
