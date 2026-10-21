'use client';

// The upload dialog of the Followers tab (Plan 15b). The chosen export files are size-checked BEFORE they are read and
// parsed HERE, in the browser (lib/followers/parse.ts); only usernames and follow times are posted (as the compact
// payload of lib/followers/payload.ts) to the owner-only route, which checks everything again. The raw files never
// leave the device. Errors are keys of pages.account.followerDiff.errors.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
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
import { Input } from '@/components/ui/input';
import { formatNumber } from '@/lib/format';
import { checkFiles, MAX_FILES, MAX_FOLLOWERS, MAX_FOLLOWING, parseExportFiles, type ParseError, type Parsed } from '@/lib/followers/parse';
import { FIRST_DAY, MAX_BODY_BYTES, MAX_SNAPSHOTS, toPayload } from '@/lib/followers/payload';

type ErrorKey = ParseError | 'badDate' | 'unauthorized' | 'invalid' | 'tooLarge' | 'notFound' | 'notReady' | 'tooManySnapshots' | 'unexpected';
const SERVER_ERRORS: readonly string[] = ['unauthorized', 'invalid', 'tooLarge', 'notFound', 'notReady', 'tooManySnapshots', 'unexpected'];
const MAX: Partial<Record<ErrorKey, number>> = { tooManyFiles: MAX_FILES, fileTooLarge: 32, totalTooLarge: 64, tooManyFollowers: MAX_FOLLOWERS, tooManyFollowing: MAX_FOLLOWING, tooManySnapshots: MAX_SNAPSHOTS };

export function FollowerUpload({ accountId, username, today }: { accountId: string; username: string; today: string }) {
  const t = useTranslations('pages.account.followerDiff');
  const { prefs } = usePrefs();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<{ key: ErrorKey; file?: string } | null>(null);
  const [busy, setBusy] = useState<'reading' | 'sending' | null>(null);
  const n = (v: number) => formatNumber(v, prefs, { maximumFractionDigits: 0 });

  const reset = () => {
    setParsed(null);
    setError(null);
    setDate(today);
    setBusy(null);
  };

  async function read(list: File[]) {
    setParsed(null);
    setError(null);
    const bad = checkFiles(list.map((f) => ({ name: f.name, size: f.size }))); // before a byte is read
    if (bad) return setError({ key: bad.error, file: bad.file });
    setBusy('reading');
    try {
      const files = await Promise.all(list.map(async (f) => ({ name: f.name, text: await f.text() })));
      const r = parseExportFiles(files, Math.floor(Date.now() / 1000));
      if (r.ok) setParsed(r);
      else setError({ key: r.error, file: r.file });
    } catch {
      setError({ key: 'badJson' });
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!parsed) return setError({ key: 'noFiles' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < FIRST_DAY) return setError({ key: 'badDate' });
    const body = toPayload({ takenOn: date, followers: parsed.followers, following: parsed.following });
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return setError({ key: 'tooLarge' });
    setBusy('sending');
    setError(null);
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/followers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, credentials: 'same-origin' });
      if (res.status === 201) {
        setOpen(false);
        reset();
        router.refresh(); // the new snapshot appears in the tab
        return;
      }
      const key = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error;
      setError({ key: typeof key === 'string' && SERVER_ERRORS.includes(key) ? (key as ErrorKey) : res.redirected ? 'unauthorized' : 'unexpected' });
    } catch {
      setError({ key: 'unexpected' });
    }
    setBusy(null);
  }

  const message = error ? t(`errors.${error.key}`, { file: error.file ?? '', max: n(MAX[error.key] ?? 0) }) : null;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button type="button">
          <Upload aria-hidden="true" />
          {t('upload.open')}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{t('upload.title')}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{t('upload.description', { username })}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="grid gap-[var(--gp)]">
          <FormField id="follower-files" label={t('upload.files')} hint={t('upload.filesHint')}>
            {(p) => <Input {...p} type="file" multiple accept=".json,application/json" onChange={(e) => void read([...(e.target.files ?? [])])} />}
          </FormField>
          <div aria-live="polite" className="grid gap-1 text-sm">
            {busy === 'reading' ? <p className="text-muted-foreground">{t('upload.reading')}</p> : null}
            {parsed ? (
              <>
                <p>{parsed.following ? t('upload.preview', { followers: parsed.followers.length, following: parsed.following.length }) : t('upload.previewNoFollowing', { followers: parsed.followers.length })}</p>
                {parsed.skipped ? <p className="text-xs text-muted-foreground">{t('upload.skipped', { count: parsed.skipped })}</p> : null}
                {parsed.ignored.length ? <p className="text-xs text-muted-foreground">{t('upload.ignored', { files: parsed.ignored.join(', ') })}</p> : null}
              </>
            ) : null}
          </div>
          <FormField id="follower-date" label={t('upload.date')} hint={t('upload.dateHint')}>
            {(p) => <Input {...p} type="date" min={FIRST_DAY} max={today} value={date} onChange={(e) => setDate(e.target.value)} />}
          </FormField>
          {message ? (
            <p role="alert" className="text-xs text-destructive">
              {message}
            </p>
          ) : null}
        </div>
        <ResponsiveDialogFooter>
          <ResponsiveDialogClose asChild>
            <Button type="button" variant="outline">
              {t('upload.cancel')}
            </Button>
          </ResponsiveDialogClose>
          <LoadingButton type="button" pending={busy === 'sending'} disabled={!parsed || busy !== null} onClick={() => void send()}>
            {t('upload.submit')}
          </LoadingButton>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
