'use client';

// Account detail frame: back link, header, the Time Scope bar and the four tabs. The tab is URL state (?tab=…): choosing
// one navigates (keeping the scope) and the server renders ONLY that tab's data as `children`. Radix Tabs gives
// tablist/tab/tabpanel roles + arrow keys; activationMode="manual" so arrowing between tabs does not fire a navigation
// per key press. The bar sits outside the tab's Suspense boundary, so it stays usable while a tab loads.
import { useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { startProgress } from '@/components/shared/NavigationProgress';
import { PageHeader } from '@/components/shared/PageHeader';
import { TimeScopeBar } from '@/components/shared/TimeScopeBar';
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

/** `keep` = the page's own parameters (tab, Posts filters) that a scope change keeps; the Audience tab has no time range. */
export function AccountView({ account, tab, scope, today, keep, exportButton, children }: { account: AccountHead; tab: Tab; scope: ResolvedScope; today: string; keep: Record<string, string>; exportButton?: ReactNode; children: ReactNode }) {
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
            <Button asChild variant="outline" size="sm">
              <Link href={`/calendar?account=${account.id}${q}`}>
                <CalendarDays aria-hidden="true" />
                {t('calendar')}
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={`https://www.instagram.com/${encodeURIComponent(account.username)}/`} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                {t('instagram')}
              </a>
            </Button>
          </>
        }
      />
      {tab === 'audience' ? null : <TimeScopeBar scope={scope} today={today} keep={keep} />}
      <Tabs value={tab} activationMode="manual" onValueChange={choose} className="min-w-0">
        <TabsList aria-label={t('tabs')} className="max-w-full justify-start overflow-x-auto">
          {TABS.map((v) => (
            <TabsTrigger key={v} value={v} className="flex-none">
              {t(`tab.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((v) => (
          <TabsContent key={v} value={v} aria-busy={pending || undefined} className={cn('min-w-0 pt-[var(--gp)] transition-opacity', pending && 'opacity-60')}>
            {v === tab ? children : null}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
