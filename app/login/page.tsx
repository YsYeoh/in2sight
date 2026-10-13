import { getTranslations } from 'next-intl/server';
import { LoginForm } from '@/components/auth/LoginForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { signInAction } from '@/app/login/actions';

export default async function LoginPage() {
  const t = await getTranslations('auth');
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t('login.title')}</CardTitle>
          <CardDescription>{t('login.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm action={signInAction} />
        </CardContent>
      </Card>
    </main>
  );
}
