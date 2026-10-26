import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/auth/LoginForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signInAction } from '@/app/login/actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations('auth');
  const resetDone = (await searchParams).reset === 'done'; // the only accepted value; nothing else is echoed
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-[var(--gp)]">
          {resetDone ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('login.resetDone')}
            </p>
          ) : null}
          <LoginForm action={signInAction} />
          <Link href="/login/forgot" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            {t('login.forgotLink')}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
