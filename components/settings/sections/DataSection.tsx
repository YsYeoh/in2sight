import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ITEMS = ['insights', 'covers', 'comments', 'delete'] as const;

/**
 * Settings -> Data & privacy: a short "what we store" placeholder (Plan 16a).
 * Plan 16c REPLACES this file (same file name, same export, zero props) with storage used, export all and delete all.
 */
export async function DataSection() {
  const t = await getTranslations('settings.data');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul className="list-disc space-y-1 pl-5">
          {ITEMS.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t('soon')}</p>
      </CardContent>
    </Card>
  );
}
