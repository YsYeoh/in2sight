'use client';

// Settings -> Accounts & sync (Plan 16a): the state of each account and the two everyday actions. Everything else
// (groups, archive, delete, connect, import progress) stays on /accounts, linked at the top.
import { useState } from 'react';
import Link from 'next/link';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CommentsHint, Identity, SyncInfo } from '@/components/accounts/AccountParts';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { StatusBadge } from '@/components/accounts/StatusBadge';
import { TokenMeter } from '@/components/accounts/TokenMeter';
import { EmptyState } from '@/components/shared/EmptyState';
import { InsightOrb } from '@/components/shared/InsightOrb';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { tokenStatus } from '@/lib/accounts/token-status';
import type { StoredAccount } from '@/lib/accounts/types';
import type { SyncStatus } from '@/lib/sync/store';

export interface AccountsOverviewProps {
  /** non-archived accounts (the section filters) */
  accounts: StoredAccount[];
  sync: Record<string, SyncStatus>;
  /** ISO, computed on the server so first paint matches the client */
  now: string;
  syncNow: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

type Note = { ok: true; username: string } | { ok: false; text: string } | null;

export function AccountsOverview({ accounts, sync, now, syncNow }: AccountsOverviewProps) {
  const t = useTranslations('settings.accountsSync');
  const ta = useTranslations('accounts');
  const tErr = useTranslations('accounts.errors');
  const tl = useTranslations('loading');
  const router = useRouter();
  const [busy, setBusy] = useState<StoredAccount | null>(null);
  const [note, setNote] = useState<Note>(null);
  const nowDate = new Date(now);
  const errorText = (code?: string) => (code && tErr.has(code) ? tErr(code) : tErr('unexpected'));

  // a sync runs up to ~35 s inside the action (maxDuration 60 on the settings page)
  const run = async (a: StoredAccount) => {
    setBusy(a);
    setNote(null);
    try {
      const r = await syncNow(a.id);
      if (r.ok) {
        setNote({ ok: true, username: a.username });
        router.refresh();
      } else setNote({ ok: false, text: errorText(r.error) });
    } catch (e) {
      if (isRedirectError(e)) throw e;
      setNote({ ok: false, text: errorText() });
    } finally {
      setBusy(null);
    }
  };

  const manage = (
    <Button asChild variant="outline">
      <Link href="/accounts">{t('manage')}</Link>
    </Button>
  );

  return (
    <div className="grid gap-[var(--gp)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('list')}</h3>
        {manage}
      </div>
      {busy ? (
        <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <InsightOrb size="xs" decorative />
          <span className="min-w-0 break-words">{tl('syncing', { username: busy.username })}</span>
        </p>
      ) : null}
      {note?.ok ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('synced', { username: note.username })}
        </p>
      ) : null}
      {note && !note.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {note.text}
        </p>
      ) : null}
      {accounts.length === 0 ? (
        <EmptyState
          title={t('empty')}
          action={
            <Button asChild>
              <Link href="/accounts">{t('emptyAction')}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-[var(--gp)] lg:grid-cols-2">
          {accounts.map((a) => (
            <li key={a.id} className="min-w-0">
              <Card>
                <CardContent className="grid gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Identity a={a} />
                    <StatusBadge status={a.status} token={tokenStatus(a.tokenExpiresAt, nowDate).state} />
                  </div>
                  <CommentsHint a={a} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <span className="text-xs text-muted-foreground">{ta('columns.token')}</span>
                      <TokenMeter expiresAt={a.tokenExpiresAt} now={nowDate} />
                    </div>
                    <div className="grid gap-1 text-sm">
                      <span className="text-xs text-muted-foreground">{t('lastSync')}</span>
                      <SyncInfo s={sync[a.id]} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.status === 'active' ? (
                      <LoadingButton variant="outline" pending={busy?.id === a.id} disabled={busy !== null} onClick={() => void run(a)}>
                        {t('syncNow')}
                      </LoadingButton>
                    ) : null}
                    <Button asChild variant="outline">
                      <a href={connectHref(a.groupName)} target="_top">
                        {t('reconnect')}
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
