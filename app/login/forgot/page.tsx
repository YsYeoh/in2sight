import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ForgotForm } from '@/components/auth/ForgotForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requestResetAction } from '@/app/login/forgot/actions';

export default async function ForgotPage() {
  const t = await getTranslations('auth.forgot');
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('hint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-[var(--gp)]">
          <ForgotForm action={requestResetAction} />
          <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            {t('back')}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
