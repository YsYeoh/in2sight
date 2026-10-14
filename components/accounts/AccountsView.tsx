'use client';

import { useState } from 'react';
import { EllipsisVertical, Plus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/accounts/ConfirmDialog';
import { connectHref, ConnectDialog } from '@/components/accounts/ConnectDialog';
import { GroupDialog } from '@/components/accounts/GroupDialog';
import { StatusBadge } from '@/components/accounts/StatusBadge';
import { TokenMeter } from '@/components/accounts/TokenMeter';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { EmptyState } from '@/components/shared/EmptyState';
import { PageHeader } from '@/components/shared/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { normalizeGroup } from '@/lib/accounts/group';
import { tokenStatus } from '@/lib/accounts/token-status';
import type { StoredAccount } from '@/lib/accounts/types';
import { formatDate, formatNumber } from '@/lib/format';

type Result = { ok: boolean; error?: string };
export interface AccountsActions {
  archive(id: string): Promise<Result>;
  restore(id: string): Promise<Result>;
  remove(id: string): Promise<Result>;
  setGroup(id: string, group: string | null): Promise<Result>;
}

// error keys the OAuth callback redirects with; anything else in the URL is ignored
const NOTICE_ERRORS = ['access_denied', 'state_mismatch', 'missing_code', 'exchange_failed', 'profile_failed', 'not_professional', 'save_failed', 'not_configured'];

interface RowProps {
  accounts: StoredAccount[];
  now: Date;
  onEditGroup: (a: StoredAccount) => void;
  onArchive: (a: StoredAccount) => void;
}

function Identity({ a }: { a: StoredAccount }) {
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

function GroupBadge({ name }: { name: string | null }) {
  const t = useTranslations('accounts.token');
  return name ? (
    <Badge variant="outline" className="max-w-48 truncate">
      {name}
    </Badge>
  ) : (
    <span className="text-muted-foreground">{t('unknown')}</span>
  );
}

function RowMenu({ a, onEditGroup, onArchive }: { a: StoredAccount } & Pick<RowProps, 'onEditGroup' | 'onArchive'>) {
  const t = useTranslations('accounts.menu');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('open')}>
          <EllipsisVertical aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEditGroup(a)}>{t('editGroup')}</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={connectHref(a.groupName)}>{t('reconnect')}</a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onArchive(a)}>
          {t('archive')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccountTable({ accounts, now, ...menu }: RowProps) {
  const t = useTranslations('accounts');
  const { prefs } = usePrefs();
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columns.account')}</TableHead>
            <TableHead>{t('columns.group')}</TableHead>
            <TableHead>{t('columns.token')}</TableHead>
            <TableHead>{t('columns.status')}</TableHead>
            <TableHead>{t('columns.connected')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('menu.open')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Identity a={a} />
              </TableCell>
              <TableCell>
                <GroupBadge name={a.groupName} />
              </TableCell>
              <TableCell>
                <TokenMeter expiresAt={a.tokenExpiresAt} now={now} />
              </TableCell>
              <TableCell>
                <StatusBadge status={a.status} token={tokenStatus(a.tokenExpiresAt, now).state} />
              </TableCell>
              <TableCell>{formatDate(a.connectedAt, prefs)}</TableCell>
              <TableCell>
                <RowMenu a={a} {...menu} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AccountCards({ accounts, now, ...menu }: RowProps) {
  const t = useTranslations('accounts');
  const { prefs } = usePrefs();
  return (
    <ul className="grid gap-[var(--gp)] md:hidden">
      {accounts.map((a) => (
        <li key={a.id}>
          <Card>
            <CardContent className="grid gap-3">
              <div className="flex items-start justify-between gap-2">
                <Identity a={a} />
                <RowMenu a={a} {...menu} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} token={tokenStatus(a.tokenExpiresAt, now).state} />
                <GroupBadge name={a.groupName} />
              </div>
              <TokenMeter expiresAt={a.tokenExpiresAt} now={now} />
              <p className="text-xs text-muted-foreground">
                {t('columns.connected')} {formatDate(a.connectedAt, prefs)}
              </p>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// named groups alphabetically; archived accounts and isolated (no group) accounts kept apart
function groupAccounts(accounts: StoredAccount[], locale: string) {
  const byGroup = new Map<string, StoredAccount[]>();
  const isolated: StoredAccount[] = [];
  const archived: StoredAccount[] = [];
  for (const a of accounts) {
    if (a.status === 'archived') archived.push(a);
    else if (a.groupName) byGroup.set(a.groupName, [...(byGroup.get(a.groupName) ?? []), a]);
    else isolated.push(a);
  }
  const named = [...byGroup.entries()].sort(([x], [y]) => x.localeCompare(y, locale));
  const allGroups = [...new Set(accounts.map((a) => a.groupName).filter((g): g is string => !!g))].sort((x, y) => x.localeCompare(y, locale));
  return { named, isolated, archived, allGroups };
}

export function AccountsView({
  accounts,
  actions,
  notice,
  now,
}: {
  accounts: StoredAccount[];
  actions: AccountsActions;
  notice?: { connected?: string; error?: string };
  now: string; // ISO, computed on the server so first paint matches the client
}) {
  const t = useTranslations('accounts');
  const tErr = useTranslations('accounts.errors');
  const { prefs } = usePrefs();
  const nowDate = new Date(now);
  const [pendingArchive, setPendingArchive] = useState<StoredAccount | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoredAccount | null>(null);
  const [editGroup, setEditGroup] = useState<StoredAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { named, isolated, archived, allGroups } = groupAccounts(accounts, prefs.locale);

  const errorText = (code?: string) => (code && tErr.has(code) ? tErr(code) : tErr('unexpected'));
  const dialogOpen = !!(pendingArchive || pendingDelete || editGroup);
  const closeDialogs = () => {
    setPendingArchive(null);
    setPendingDelete(null);
    setEditGroup(null);
    setError(null);
  };

  // no catch: a redirect thrown by the owner check must reach Next's router
  async function run(fn: () => Promise<Result>, onDone: () => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) onDone();
      else setError(errorText(r.error));
    } finally {
      setBusy(false);
    }
  }

  function saveGroup(raw: string) {
    const g = normalizeGroup(raw);
    if (!g.ok) return setError(errorText('invalid_group'));
    void run(() => actions.setGroup(editGroup!.id, g.value), closeDialogs);
  }

  const menu = { now: nowDate, onEditGroup: setEditGroup, onArchive: setPendingArchive };
  const sections = [...named.map(([name, list]) => ({ name, list })), ...(isolated.length ? [{ name: t('isolated'), list: isolated }] : [])];
  const noticeError = notice?.error && NOTICE_ERRORS.includes(notice.error) ? notice.error : null;
  const addButton = (
    <Button>
      <Plus aria-hidden="true" />
      {t('add')}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} actions={<ConnectDialog groups={allGroups} trigger={addButton} />} />

      {notice?.connected ? (
        <Alert role="status" className="mb-[var(--gp)]">
          {t('connectedAs', { username: `@${notice.connected}` })}
        </Alert>
      ) : null}
      {noticeError ? (
        <Alert variant="destructive" className="mb-[var(--gp)]">
          {tErr(noticeError)}
        </Alert>
      ) : null}
      {error && !dialogOpen ? (
        <Alert variant="destructive" className="mb-[var(--gp)]">
          {error}
        </Alert>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState icon={<Users aria-hidden="true" className="size-5" />} title={t('empty')} description={t('emptyHint')} action={<ConnectDialog groups={allGroups} trigger={addButton} />} />
      ) : (
        <div className="grid gap-[calc(var(--gp)*1.5)]">
          {sections.map(({ name, list }) => (
            <section key={name}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <span className="min-w-0 truncate">{name}</span>
                <Badge variant="secondary">{formatNumber(list.length, prefs)}</Badge>
              </h2>
              <AccountTable accounts={list} {...menu} />
              <AccountCards accounts={list} {...menu} />
            </section>
          ))}

          {archived.length > 0 ? (
            <details className="rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t('archivedTitle', { count: formatNumber(archived.length, prefs) })}</summary>
              <ul className="divide-y border-t">
                {archived.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate font-medium">@{a.username}</span>
                      {a.groupName ? <GroupBadge name={a.groupName} /> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => actions.restore(a.id), () => {})}>
                        {t('menu.restore')}
                      </Button>
                      <Button variant="outline" size="sm" className="text-destructive" disabled={busy} onClick={() => setPendingDelete(a)}>
                        {t('menu.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {pendingArchive ? (
        <ConfirmDialog
          open
          title={t('archive.title', { username: pendingArchive.username })}
          body={t('archive.body')}
          confirmLabel={t('archive.confirm')}
          cancelLabel={t('connect.cancel')}
          busy={busy}
          error={error}
          onConfirm={() => void run(() => actions.archive(pendingArchive.id), closeDialogs)}
          onClose={closeDialogs}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmDialog
          open
          title={t('delete.title', { username: pendingDelete.username })}
          body={t('delete.body')}
          confirmLabel={t('delete.confirm')}
          cancelLabel={t('delete.cancel')}
          requireText={`@${pendingDelete.username}`}
          busy={busy}
          error={error}
          onConfirm={() => void run(() => actions.remove(pendingDelete.id), closeDialogs)}
          onClose={closeDialogs}
        />
      ) : null}
      <GroupDialog account={editGroup} groups={allGroups} busy={busy} error={error} onSave={saveGroup} onClose={closeDialogs} />
    </>
  );
}
