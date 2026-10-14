'use client';

// Account detail frame: back link, header, and the four tabs. The tab is URL state (?tab=…): choosing one navigates and
// the server renders ONLY that tab's data as `children`. Radix Tabs gives tablist/tab/tabpanel roles + arrow keys;
// activationMode="manual" so arrowing between tabs does not fire a navigation per key press.
import { useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarDays, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TABS, type Tab } from '@/lib/dashboard/account';
import { cn } from '@/lib/utils';

interface AccountHead {
  id: string;
  username: string;
  displayName: string | null;
  groupName: string | null;
}

export function AccountView({ account, tab, children }: { account: AccountHead; tab: Tab; children: ReactNode }) {
  const t = useTranslations('pages.account');
  const router = useRouter();
  const [pending, start] = useTransition();
  const subtitle = [account.displayName, account.groupName].filter(Boolean).join(' · ') || undefined;
  return (
    <>
      <Link href="/overview" className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        {t('back')}
      </Link>
      <PageHeader
        title={`@${account.username}`}
        subtitle={subtitle}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/calendar?account=${account.id}`}>
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
      <Tabs value={tab} activationMode="manual" onValueChange={(v) => start(() => router.push(`?tab=${v}`, { scroll: false }))} className="min-w-0">
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
