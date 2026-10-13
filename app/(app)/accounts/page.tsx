import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/shared/PageHeader';

export default async function AccountsPage() {
  const t = await getTranslations('pages.accounts');
  return <PageHeader title={t('title')} />;
}
