'use client';

import { useState } from 'react';
import { FormField } from '@/components/shared/FormField';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  error: string | null;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

// Lives inside AlertDialogContent, which unmounts on close, so the typed text resets by itself.
function Body({ title, body, confirmLabel, cancelLabel, busy, error, requireText, onConfirm }: Omit<Props, 'open' | 'onClose'>) {
  const [typed, setTyped] = useState('');
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{body}</AlertDialogDescription>
      </AlertDialogHeader>
      {requireText ? (
        <FormField id="confirm-text" label={requireText}>
          {(p) => <Input {...p} value={typed} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />}
        </FormField>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <AlertDialogFooter>
        <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={busy || (requireText !== undefined && typed !== requireText)}
          onClick={(e) => {
            e.preventDefault(); // stay open until the action reports back
            onConfirm();
          }}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

export function ConfirmDialog({ open, onClose, ...rest }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <Body {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
