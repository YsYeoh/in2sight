'use client';

// Export dialog (SPEC §7d): format, scope, period, and for the PDF report its sections, title and note.
import { useState, useTransition } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FormField } from '@/components/shared/FormField';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PERIODS, type Period } from '@/lib/analysis/types';
import { downloadExport, exportUrl, type ExportFormat } from '@/lib/export/download';
import { NOTE_MAX, SECTIONS, TITLE_MAX, type ScopeOption, type Section } from '@/lib/export/params';

export function ExportDialog({ scopes, defaultScope, period }: { scopes: ScopeOption[]; defaultScope: string; period: Period }) {
  const t = useTranslations('export');
  const to = useTranslations('pages.overview');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [scope, setScope] = useState(scopes.some((s) => s.value === defaultScope) ? defaultScope : 'all');
  const [per, setPer] = useState<Period>(period);
  const [sections, setSections] = useState<Section[]>([...SECTIONS]);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: true } | { ok: false; error: string } | null>(null);
  const [pending, start] = useTransition();
  const request = { format, scope, period: per, sections, title, note };
  const label = (s: ScopeOption) => (s.kind === 'all' ? t('scopeAll') : s.kind === 'account' ? `@${s.name}` : s.name);
  const toggle = (s: Section, on: boolean) => setSections((list) => SECTIONS.filter((x) => (x === s ? on : list.includes(x))));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (format === 'pdf' && sections.length === 0) return setResult({ ok: false, error: 'no_sections' });
    setResult(null);
    start(async () => setResult(await downloadExport(exportUrl(request), format)));
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setResult(null);
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download aria-hidden="true" />
          {t('button')}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="max-h-[90dvh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('description')}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <form onSubmit={submit} className="grid min-w-0 gap-[var(--gp)]">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('format')}</legend>
            <RadioGroup value={format} onValueChange={(v) => setFormat(v as ExportFormat)} aria-label={t('format')}>
              {(['xlsx', 'pdf'] as const).map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <RadioGroupItem value={f} id={`export-format-${f}`} />
                  <Label htmlFor={`export-format-${f}`}>{t(`formats.${f}`)}</Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <div className="grid min-w-0 gap-[var(--gp)] sm:grid-cols-2">
            <FormField id="export-scope" label={t('scope')}>
              {(p) => (
                <Select value={scope} onValueChange={setScope}>
                  <SelectTrigger {...p} className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopes.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <span className="truncate" dir="auto">{label(s)}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('period')}</legend>
              <RadioGroup value={String(per)} onValueChange={(v) => setPer(Number(v) as Period)} aria-label={t('period')} className="flex flex-wrap gap-3">
                {PERIODS.map((d) => (
                  <div key={d} className="flex items-center gap-2">
                    <RadioGroupItem value={String(d)} id={`export-period-${d}`} />
                    <Label htmlFor={`export-period-${d}`}>{to('periodOption', { days: d })}</Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          </div>

          {format === 'pdf' ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t('sections')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SECTIONS.map((s) => (
                    <div key={s} className="flex min-w-0 items-center gap-2">
                      <Checkbox id={`export-section-${s}`} checked={sections.includes(s)} onCheckedChange={(v) => toggle(s, v === true)} />
                      <Label htmlFor={`export-section-${s}`} className="min-w-0">{t(`section.${s}`)}</Label>
                    </div>
                  ))}
                </div>
              </fieldset>
              <FormField id="export-title" label={t('reportTitle')} hint={t('reportTitleHint')}>
                {(p) => <Input {...p} value={title} maxLength={TITLE_MAX} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />}
              </FormField>
              <FormField id="export-note" label={t('note')} hint={t('noteHint')}>
                {(p) => <Textarea {...p} value={note} maxLength={NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} />}
              </FormField>
              <p className="text-xs text-muted-foreground">{t('pdfSlow')}</p>
            </>
          ) : null}

          {result && !result.ok ? (
            <p role="alert" className="text-sm text-destructive">
              {t(`errors.${result.error}` as 'errors.unexpected')}
            </p>
          ) : null}
          {result?.ok ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('done')}
            </p>
          ) : null}

          <ResponsiveDialogFooter className="flex-wrap gap-2">
            {format === 'pdf' ? (
              <Button asChild variant="ghost">
                <a href={exportUrl(request, 'preview')} target="_blank" rel="noopener">
                  <ExternalLink aria-hidden="true" />
                  {t('preview')}
                </a>
              </Button>
            ) : null}
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                {tc('cancel')}
              </Button>
            </ResponsiveDialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
              <Download aria-hidden="true" />
              {pending ? t('working') : t('download')}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
