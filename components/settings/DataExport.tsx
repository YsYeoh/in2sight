'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { downloadExport } from '@/lib/export/download';

export interface ExportItem {
  name: string;
  label: string;
  thirdParty: boolean;
}

const urlFor = (name: string) => `/api/export/data?${new URLSearchParams({ table: name })}`;

/**
 * "Export your data" (Plan 16c): one JSON file per table, fetched one after another (never in parallel: each file is
 * one streamed request on the server). Other people's data only when the owner ticks the box (Download all) or picks
 * that single file. Results: `role="status"` for progress and success, `role="alert"` for an error.
 */
export function DataExport({ items }: { items: ExportItem[] }) {
  const t = useTranslations('settings.data.export');
  const te = useTranslations('export.errors');
  const [others, setOthers] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // 'all' or a table name
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(list: ExportItem[], key: string) {
    setBusy(key);
    setError(null);
    setDone(null);
    for (let i = 0; i < list.length; i++) {
      setProgress({ done: i + 1, total: list.length });
      const r = await downloadExport(urlFor(list[i].name), 'json');
      if (!r.ok) {
        setError(r.error);
        setProgress(null);
        setBusy(null);
        return;
      }
    }
    setProgress(null);
    setDone(list.length);
    setBusy(null);
  }

  return (
    <div className="grid gap-[var(--gp)]">
      <div className="flex items-start gap-2">
        <Checkbox id="export-others" checked={others} onCheckedChange={(v) => setOthers(v === true)} disabled={busy !== null} aria-describedby="export-others-hint" />
        <div className="grid min-w-0 gap-1">
          <Label htmlFor="export-others">{t('others')}</Label>
          <p id="export-others-hint" className="text-sm text-muted-foreground">
            {t('othersHint')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[var(--gp)]">
        <LoadingButton type="button" pending={busy === 'all'} disabled={busy !== null} onClick={() => void run(items.filter((x) => others || !x.thirdParty), 'all')}>
          <Download aria-hidden="true" />
          {t('all')}
        </LoadingButton>
        <p className="text-sm text-muted-foreground">{t('browserHint')}</p>
      </div>
      <p role="status" className="text-sm">
        {progress ? t('progress', progress) : done !== null ? t('done', { count: done }) : null}
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {te(error)}
        </p>
      ) : null}
      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t('single')}</summary>
        <ul className="divide-y">
          {items.map((x) => (
            <li key={x.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                <span className="break-words">{x.label}</span>
                {x.thirdParty ? <Badge variant="outline">{t('thirdParty')}</Badge> : null}
              </span>
              <Button type="button" variant="outline" size="sm" disabled={busy !== null} aria-label={`${t('download')}: ${x.label}`} onClick={() => void run([x], x.name)}>
                <Download aria-hidden="true" />
                {t('download')}
              </Button>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
