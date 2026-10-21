'use client';

// Account detail frame: back link, header and the underline tabs (Overview / Growth / Posts / Stories). The tab is URL state
// (?tab=…): choosing one navigates (keeping the scope) and the server renders ONLY that tab's data as `children`. Radix
// Tabs gives tablist/tab/tabpanel roles + arrow keys; activationMode="manual" so arrowing between tabs does not fire a
// navigation per key press. The range bar lives in the Overview and Growth panels only, outside the tab's Suspense boundary, so it
// stays usable while the tab streams.
import { useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { startProgress } from '@/components/shared/NavigationProgress';
import { PageHeader } from '@/components/shared/PageHeader';
import { RangeBar } from '@/components/shared/RangeBar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TABS, type Tab } from '@/lib/dashboard/account';
import type { ResolvedScope } from '@/lib/time-scope/scope';
import { cn } from '@/lib/utils';

interface AccountHead {
  id: string;
  username: string;
  displayName: string | null;
  groupName: string | null;
}

export function AccountView({ account, tab, scope, today, exportButton, children }: { account: AccountHead; tab: Tab; scope: ResolvedScope; today: string; exportButton?: ReactNode; children: ReactNode }) {
  const t = useTranslations('pages.account');
  const router = useRouter();
  const [pending, start] = useTransition();
  const subtitle = [account.displayName, account.groupName].filter(Boolean).join(' · ') || undefined;
  const q = scope.query ? `&${scope.query}` : '';
  const choose = (v: string) => {
    const href = `?tab=${v}${q}`;
    startProgress(href); // router.push is not a link click: tell the top bar
    start(() => router.push(href, { scroll: false }));
  };
  return (
    <>
      <Link href={`/overview${scope.query ? `?${scope.query}` : ''}`} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        {t('back')}
      </Link>
      <PageHeader
        title={`@${account.username}`}
        subtitle={subtitle}
        actions={
          <>
            {exportButton}
            <Button asChild variant="outline">
              <Link href={`/calendar?account=${account.id}${q}`}>
                <CalendarDays aria-hidden="true" />
                {t('calendar')}
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <a href={`https://www.instagram.com/${encodeURIComponent(account.username)}/`} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {t('instagram')}
              </a>
            </Button>
          </>
        }
      />
      <Tabs value={tab} activationMode="manual" onValueChange={choose} className="min-w-0">
        <TabsList variant="line" aria-label={t('tabs')}>
          {TABS.map((v) => (
            <TabsTrigger key={v} value={v} className="flex-none">
              {t(`tab.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((v) => (
          <TabsContent key={v} value={v} aria-busy={pending || undefined} className={cn('min-w-0 pt-[var(--gp)] transition-opacity', pending && 'opacity-60')}>
            {v === tab ? (
              <>
                {v === 'overview' || v === 'growth' ? <RangeBar scope={scope} today={today} keep={v === 'growth' ? { tab: v } : undefined} /> : null}
                {children}
              </>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
