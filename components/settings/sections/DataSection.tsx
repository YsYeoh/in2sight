import { getTranslations } from 'next-intl/server';
import { DataExport } from '@/components/settings/DataExport';
import { DeleteAllData } from '@/components/settings/DeleteAllData';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteAllDataAction } from '@/app/(app)/settings/data-actions';
import { supabaseAccountsStore } from '@/lib/accounts/supabase-store';
import { requireOwner } from '@/lib/auth/require-owner';
import { DELETE_PHRASE } from '@/lib/data/delete';
import { EXPORT_TABLES } from '@/lib/data/export';
import { readUsage } from '@/lib/data/usage';
import { formatBytes, formatCompact } from '@/lib/format';
import { getPrefs } from '@/lib/prefs.server';
import { createServerSupabase } from '@/lib/supabase/server';

const ITEMS = ['insights', 'covers', 'comments', 'delete', 'privacy'] as const;

/** Settings -> Data & privacy (Plan 16c): what is stored, storage used, export all, delete all. */
export async function DataSection() {
  const { email } = await requireOwner();
  const [t, prefs, db] = await Promise.all([getTranslations('settings.data'), getPrefs(), createServerSupabase()]);
  const [usage, accounts] = await Promise.all([readUsage(db), supabaseAccountsStore(db).list().catch(() => [])]);
  const username = new Map(accounts.map((a) => [a.id, `@${a.username}`]));
  return (
    <div className="grid gap-[var(--gp)]">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {ITEMS.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('usage.title')}</CardTitle>
          <CardDescription>{t('usage.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-[var(--gp)] text-sm">
          {usage ? (
            <>
              <p>
                <span className="font-medium">{t('usage.database')}: </span>
                <span className="tabular-nums">{formatBytes(usage.database, prefs)}</span>
                <span className="block text-muted-foreground">{t('usage.databaseHint')}</span>
              </p>
              <table className="w-full">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-2 font-normal">{t('usage.group')}</th>
                    <th scope="col" className="py-1 pr-2 text-right font-normal">{t('usage.rows')}</th>
                    <th scope="col" className="py-1 text-right font-normal">{t('usage.size')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {usage.groups.map((g) => (
                    <tr key={g.id}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal break-words">{t(`usage.groups.${g.id}`)}</th>
                      <td className="py-1 pr-2 text-right tabular-nums">{formatCompact(g.rows, prefs)}</td>
                      <td className="py-1 text-right tabular-nums">{formatBytes(g.bytes, prefs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="grid gap-1">
                <p className="font-medium">{t('usage.covers')}</p>
                {usage.covers.length === 0 ? (
                  <p className="text-muted-foreground">{t('usage.noCovers')}</p>
                ) : (
                  <ul className="divide-y">
                    {usage.covers.map((c) => (
                      <li key={c.folder} className="flex flex-wrap justify-between gap-x-2 py-1">
                        <span className="min-w-0 break-words">{username.get(c.folder) ?? t('usage.unlinked')}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {t('usage.images', { count: c.files })} · {formatBytes(c.bytes, prefs)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">{t('usage.needsUpdate')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('export.title')}</CardTitle>
          <CardDescription>{t('export.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <DataExport items={EXPORT_TABLES.map((x) => ({ name: x.name, label: t(`tables.${x.name}`), thirdParty: 'thirdParty' in x && x.thirdParty === true }))} />
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle>{t('deleteAll.title')}</CardTitle>
          <CardDescription>{t('deleteAll.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-[var(--gp)] text-sm">
          <p>{t('deleteAll.removes')}</p>
          <p>{t('deleteAll.keeps')}</p>
          <p className="text-muted-foreground">{t('deleteAll.instagram')}</p>
          <DeleteAllData action={deleteAllDataAction} email={email} phrase={DELETE_PHRASE} />
        </CardContent>
      </Card>
    </div>
  );
}
