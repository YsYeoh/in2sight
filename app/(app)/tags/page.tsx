import { Tag } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';

export default async function TagsPage() {
  const t = await getTranslations('pages.tags');
  return (
    <>
      <PageHeader title={t('title')} />
      <EmptyState icon={<Tag className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} />
    </>
  );
}
