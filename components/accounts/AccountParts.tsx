'use client';

// Pieces of an account row shared by the Accounts page and Settings -> Accounts & sync (Plan 16a: extracted on the second use).
import { useTranslations } from 'next-intl';
import { connectHref } from '@/components/accounts/ConnectDialog';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { COMMENTS_SCOPE, hasScope } from '@/lib/accounts/scopes';
import type { StoredAccount } from '@/lib/accounts/types';
import { formatDateTime } from '@/lib/format';
import type { SyncStatus } from '@/lib/sync/store';

/** "last synced" plus the latest error, translated from the key the sync stored */
export function SyncInfo({ s }: { s?: SyncStatus }) {
  const t = useTranslations('accounts');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const err = s?.lastErrorKey && s.consecutiveFailures > 0 ? s.lastErrorKey : null;
  return (
    <div className="grid min-w-0 gap-0.5">
      <span>{s?.lastSuccessAt ? formatDateTime(s.lastSuccessAt, prefs) : t('sync.never')}</span>
      {err ? <span className="text-xs text-destructive">{tErr.has(err) ? tErr(err) : tErr('unexpected')}</span> : null}
    </div>
  );
}

export function Identity({ a }: { a: StoredAccount }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar>
        <AvatarFallback>{[...a.username][0]?.toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">@{a.username}</p>
        {a.displayName ? <p className="truncate text-xs text-muted-foreground">{a.displayName}</p> : null}
      </div>
    </div>
  );
}

/**
 * An active account whose token lacks the comments scope (connected before it was requested, or declined): one
 * Reconnect grants it. Needs-reconnect accounts already say "Reconnect"; archived ones are not synced.
 */
export function CommentsHint({ a }: { a: StoredAccount }) {
  const t = useTranslations('accounts');
  if (a.status !== 'active' || hasScope(a, COMMENTS_SCOPE)) return null;
  return (
    <a href={connectHref(a.groupName)} target="_top" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
      {t('commentsHint')}
    </a>
  );
}
