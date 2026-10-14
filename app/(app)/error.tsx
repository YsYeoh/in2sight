'use client';

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';

// error.message is never shown: it can carry server details. The digest stays in the server logs.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('pages.error');
  return (
    <EmptyState
      icon={<TriangleAlert className="size-5" aria-hidden />}
      title={t('title')}
      description={t('hint')}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={reset}>
            {t('retry')}
          </Button>
          <Button asChild variant="outline">
            <Link href="/accounts">{t('accounts')}</Link>
          </Button>
        </div>
      }
    />
  );
}
