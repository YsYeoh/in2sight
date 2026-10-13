import { getTranslations } from 'next-intl/server';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { PageHeader } from '@/components/shared/PageHeader';
import { PrefsBar } from '@/components/shared/PrefsBar';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getMfaStatus } from '@/lib/auth/mfa';
import { requireOwner } from '@/lib/auth/require-owner';
import { createServerSupabase } from '@/lib/supabase/server';
import { confirmEnrollAction, disableAction, startEnrollAction } from './actions';

export default async function SettingsPage() {
  const t = await getTranslations('settings');
  const { email } = await requireOwner(); // layouts don't re-run on client navigation, so the page checks too (and needs the email)
  const status = await getMfaStatus(await createServerSupabase());
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">{t('tabs.general')}</TabsTrigger>
          <TabsTrigger value="account">{t('tabs.account')}</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <Card>
            <CardContent>
              <PrefsBar />
            </CardContent>
          </Card>
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
