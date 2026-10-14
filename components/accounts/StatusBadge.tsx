'use client';

import { Archive, CircleCheck, Clock, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { AccountStatus } from '@/lib/accounts/types';
import type { tokenStatus } from '@/lib/accounts/token-status';

// icon + text, never colour alone
export function StatusBadge({ status, token }: { status: AccountStatus; token: ReturnType<typeof tokenStatus>['state'] }) {
  const t = useTranslations('accounts.status');
  if (status === 'archived')
    return (
      <Badge variant="outline">
        <Archive aria-hidden="true" />
        {t('archived')}
      </Badge>
    );
  if (status === 'needs_reconnect' || token === 'expired')
    return (
      <Badge variant="destructive">
        <TriangleAlert aria-hidden="true" />
        {t('reconnect')}
      </Badge>
    );
  if (token === 'expiring')
    return (
      <Badge variant="outline">
        <Clock aria-hidden="true" />
        {t('expiring')}
      </Badge>
    );
  return (
    <Badge variant="secondary">
      <CircleCheck aria-hidden="true" />
      {t('active')}
    </Badge>
  );
}
