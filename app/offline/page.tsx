import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';

// Public (proxy.ts skips /offline) and free of private data: the service worker precaches it and shows it when a page
// navigation fails offline. Never add account data here.
export default async function OfflinePage() {
  const t = await getTranslations('pwa.offline');
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-[var(--pg)] text-center text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3">
        <WifiOff aria-hidden className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('body')}</p>
        <Link href="/overview" className={buttonVariants()}>
          {t('retry')}
        </Link>
      </div>
    </main>
  );
}
