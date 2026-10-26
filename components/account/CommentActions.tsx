'use client';

// One comment's moderation menu (Plan 15d) for the Comments tab's renderActions slot: Reply, Hide/Unhide, Delete, each
// behind its own dialog. Opening a dialog = one intent = one request id (the server refuses a repeated id); a call in
// flight blocks a second one (double click); afterwards focus returns to this menu button and the result is announced.
// The server actions arrive as PROPS (the page passes them), so this file imports no server code.
import { useRef, useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CommentsTab } from '@/components/account/CommentsTab';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog, ResponsiveDialogClose, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber } from '@/lib/format';
import { REPLY_MAX } from '@/lib/moderation/rules';
import type { ModerationResult } from '@/lib/moderation/service';

/**
 * After these answers the first try may have gone through (or was already sent), so the dialog keeps its request id: the
 * database then refuses a second send. After any other failure the id is burned (its log row exists) and the next
 * confirm needs a new one.
 */
const KEEP_REQUEST_ID: readonly string[] = ['unknown_outcome', 'unexpected', 'duplicate'];
export const isDefiniteFailure = (error: string | undefined): boolean => error !== undefined && !KEEP_REQUEST_ID.includes(error);

/** Runs one moderation call at a time; translates the error key; refreshes the page when the state changed. */
export function useModerationRun() {
  const t = useTranslations('pages.account.moderation');
  const router = useRouter();
  const inFlight = useRef(false); // a ref, not state: a double click lands before the re-render
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(call: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void, onFail?: (error: string | undefined) => void): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      if (r.ok) {
        onOk?.();
        router.refresh();
        return;
      }
      setError(r.error && t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t('errors.unexpected'));
      if (r.error === 'already_done') router.refresh(); // show the current state
      onFail?.(r.error);
    } catch {
      setError(t('errors.unexpected'));
      onFail?.('unexpected'); // the call may have reached the server
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError(null) };
}

export interface CommentActionsProps {
  accountId: string;
  commentId: string;
  authorUsername: string | null;
  hidden: boolean | null;
  own: boolean;
  hide: (accountId: string, commentId: string, hide: boolean, requestId: string) => Promise<ModerationResult>;
  reply: (accountId: string, commentId: string, message: string, requestId: string) => Promise<ModerationResult>;
  remove: (accountId: string, commentId: string, requestId: string) => Promise<ModerationResult>;
}

type Open = 'reply' | 'hide' | 'delete' | null;

export function CommentActions({ accountId, commentId, authorUsername, hidden, own, hide, reply, remove }: CommentActionsProps) {
  const t = useTranslations('pages.account.moderation');
  const { prefs } = usePrefs();
  const { busy, error, run, clearError } = useModerationRun();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<Open>(null);
  const [requestId, setRequestId] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');
  const isHidden = hidden === true;
  const length = [...message.trim()].length;

  const start = (o: Exclude<Open, null>) => {
    setRequestId(crypto.randomUUID()); // one dialog = one intent = one id
    clearError();
    setStatus('');
    setOpen(o);
  };
  const close = () => {
    setOpen(null);
    setMessage('');
    clearError();
    requestAnimationFrame(() => trigger.current?.focus()); // after Radix's own focus restore
  };
  const retry = (error: string | undefined) => {
    if (isDefiniteFailure(error)) setRequestId(crypto.randomUUID()); // the old id is burned; an uncertain outcome keeps it
  };
  const finish = (done: 'hide' | 'unhide' | 'delete' | 'reply') => () => {
    setStatus(t(`done.${done}`));
    close();
  };

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={trigger} type="button" variant="ghost" size="sm" aria-label={t('menu')}>
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => start('reply')}>{t('reply')}</DropdownMenuItem>
          <DropdownMenuItem disabled={own} onSelect={() => start('hide')} className="flex-col items-start">
            {t(isHidden ? 'unhide' : 'hide')}
            {own ? <span className="text-xs text-muted-foreground">{t('ownHint')}</span> : null}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => start('delete')}>
            {t('delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span role="status" className="sr-only">
        {status}
      </span>

      <ConfirmDialog
        open={open === 'hide'}
        title={t(isHidden ? 'unhideDialog.title' : 'hideDialog.title')}
        body={t(isHidden ? 'unhideDialog.body' : 'hideDialog.body')}
        confirmLabel={t(isHidden ? 'unhideDialog.confirm' : 'hideDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={error}
        onConfirm={() => run(() => hide(accountId, commentId, !isHidden, requestId), finish(isHidden ? 'unhide' : 'hide'), retry)}
        onClose={close}
      />
      <ConfirmDialog
        open={open === 'delete'}
        title={t('deleteDialog.title')}
        body={t('deleteDialog.body', { word: t('deleteDialog.word') })}
        requireText={t('deleteDialog.word')}
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        error={error}
        onConfirm={() => run(() => remove(accountId, commentId, requestId), finish('delete'), retry)}
        onClose={close}
      />
      <ResponsiveDialog open={open === 'reply'} onOpenChange={(o) => !o && close()}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{authorUsername ? t('replyDialog.title', { username: authorUsername }) : t('replyDialog.titleNoName')}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{t('replyDialog.description')}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <form
            className="flex flex-col gap-[var(--gp)]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => reply(accountId, commentId, message, requestId), finish('reply'), retry);
            }}
          >
            <FormField id={`reply-${commentId}`} label={t('replyDialog.label')} hint={t('replyDialog.count', { count: formatNumber(length, prefs), max: formatNumber(REPLY_MAX, prefs) })} error={error ?? undefined}>
              {(p) => <Textarea {...p} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />}
            </FormField>
            <ResponsiveDialogFooter>
              <ResponsiveDialogClose asChild>
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              </ResponsiveDialogClose>
              <LoadingButton type="submit" pending={busy} disabled={length === 0 || length > REPLY_MAX}>
                {t('replyDialog.send')}
              </LoadingButton>
            </ResponsiveDialogFooter>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

export type ModerationRowActions = { ownUsername: string } & Pick<CommentActionsProps, 'hide' | 'reply' | 'remove'>;

/** The Comments tab with the moderation menu on every row (a client wrapper: functions cannot come from the server page). */
export function ModeratedCommentsTab({ moderation, ...props }: ComponentProps<typeof CommentsTab> & { moderation: ModerationRowActions | null }) {
  if (!moderation) return <CommentsTab {...props} />;
  const own = moderation.ownUsername.toLowerCase();
  return (
    <CommentsTab
      {...props}
      renderActions={(c) => (
        <CommentActions accountId={props.accountId} commentId={c.id} authorUsername={c.authorUsername} hidden={c.hidden} own={c.authorUsername?.toLowerCase() === own} hide={moderation.hide} reply={moderation.reply} remove={moderation.remove} />
      )}
    />
  );
}
