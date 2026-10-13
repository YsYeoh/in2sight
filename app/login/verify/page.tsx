import { getTranslations } from 'next-intl/server';
import { signOutAction } from '@/app/login/actions';
import { verifyMfaAction } from '@/app/login/verify/actions';
import { VerifyForm } from '@/components/auth/VerifyForm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default async function VerifyPage() {
  const t = await getTranslations('auth.verify');
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-[var(--gp)]">
          <VerifyForm action={verifyMfaAction} />
          <form action={signOutAction}>
            <Button type="submit" variant="link" className="w-full">
              {t('signOut')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
