import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

// Public on purpose (the proxy sends everyone here while config is missing). Names only: never read or print an env value.
const VARS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_APP_URL'];

export default async function SetupPage() {
  const t = await getTranslations('setup');
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)]">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-xl">{t('title')}</CardTitle>
          <CardDescription>{t('body')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ul className="space-y-1">
            {VARS.map((name) => (
              <li key={name}>
                <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{name}</code>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{t('docs')}</p>
          <p className="text-muted-foreground">
            {t('check')} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">npm run check:env</code>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
