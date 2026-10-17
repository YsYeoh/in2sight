'use client';

// Saved Explorer views: links to the stored views, "Save view" (name dialog), rename and delete (confirmed).
// The current query is saved as is; the server re-validates it (lib/explorer/views.ts) and answers with error keys.
import { useState, useTransition } from 'react';
import { Bookmark, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormField } from '@/components/shared/FormField';
import { LoadingButton } from '@/components/shared/LoadingButton';
import { NavLink } from '@/components/shared/NavLink';
import { ResponsiveDialog, ResponsiveDialogClose, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogFooter, ResponsiveDialogHeader, ResponsiveDialogTitle } from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SavedView } from '@/lib/explorer/views';
import type { ViewResult } from '@/app/(app)/explorer/actions';

export interface SavedViewsProps {
  views: SavedView[];
  query: string; // the current canonical query (Explorer + Time Scope)
  save: (name: string, query: string) => Promise<ViewResult>;
  rename: (id: string, name: string) => Promise<ViewResult>;
  remove: (id: string) => Promise<ViewResult>;
}

/** One name dialog for "save" and "rename": open while `initial` is a string. */
function NameDialog({ title, hint, initial, submit, onClose }: { title: string; hint?: string; initial: string | null; submit: (name: string) => Promise<ViewResult>; onClose: () => void }) {
  const t = useTranslations('explorer.views');
  const tErr = useTranslations('explorer.views.errors');
  const [name, setName] = useState(initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ResponsiveDialog open={initial !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await submit(name);
              if (r.ok) onClose();
              else setError(tErr(r.error));
            });
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
            {hint ? <ResponsiveDialogDescription>{hint}</ResponsiveDialogDescription> : null}
          </ResponsiveDialogHeader>
          {/* no maxLength: it counts UTF-16 units; the server checks 60 characters */}
          <FormField id="view-name" label={t('name')} error={error ?? undefined}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" dir="auto" />}
          </FormField>
          <ResponsiveDialogFooter>
            <ResponsiveDialogClose asChild>
              <Button type="button" variant="outline">
                {t('cancel')}
              </Button>
            </ResponsiveDialogClose>
            <LoadingButton type="submit" pending={pending} disabled={name.trim() === ''}>
              {t('confirm')}
            </LoadingButton>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function SavedViews({ views, query, save, rename, remove }: SavedViewsProps) {
  const t = useTranslations('explorer.views');
  const tErr = useTranslations('explorer.views.errors');
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<SavedView | null>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="saved-views" className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id="saved-views" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('title')}
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={() => setSaving(true)}>
          <Bookmark aria-hidden="true" />
          {t('save')}
        </Button>
      </div>
      {views.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid max-h-64 gap-0.5 overflow-y-auto">
          {views.map((v) => (
            <li key={v.id} className="flex min-w-0 items-center gap-1">
              <NavLink href={v.href} className="min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-sm underline-offset-4 hover:underline" dir="auto">
                {v.name}
              </NavLink>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('renameNamed', { name: v.name })} onClick={() => setRenaming(v)}>
                <Pencil aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="text-destructive" aria-label={t('deleteNamed', { name: v.name })} onClick={() => setDeleting(v)}>
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <NameDialog key={saving ? 'save' : 'save-closed'} title={t('saveTitle')} hint={t('saveHint')} initial={saving ? '' : null} submit={(name) => save(name, query)} onClose={() => setSaving(false)} />
      <NameDialog key={renaming?.id ?? 'rename-closed'} title={t('renameTitle')} initial={renaming?.name ?? null} submit={(name) => rename(renaming!.id, name)} onClose={() => setRenaming(null)} />
      <ConfirmDialog
        open={deleting !== null}
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        body={t('deleteBody')}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        busy={pending}
        error={deleteError}
        onClose={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
        onConfirm={() =>
          deleting &&
          start(async () => {
            const r = await remove(deleting.id);
            if (r.ok) setDeleting(null);
            else setDeleteError(tErr(r.error));
          })
        }
      />
    </section>
  );
}
