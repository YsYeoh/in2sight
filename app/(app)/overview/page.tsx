import Link from 'next/link';
import { CircleUserRound } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';

export default async function OverviewPage() {
  const t = await getTranslations('pages.overview');
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState
        icon={<CircleUserRound className="size-5" aria-hidden />}
        title={t('empty')}
        description={t('emptyHint')}
        action={<Button asChild><Link href="/accounts">{t('addAccount')}</Link></Button>}
      />
    </>
  );
}
