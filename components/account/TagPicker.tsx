'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LoadingButton } from '@/components/shared/LoadingButton';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Tag } from '@/lib/analysis/types';
import { MAX_TAGS_PER_POST } from '@/lib/tags';
import type { TagResult } from '@/app/(app)/tags/actions';

export type SetPostTags = (mediaId: string, tagIds: string[]) => Promise<TagResult>;

function PickerForm({ postId, label, tags, initial, setPostTags, onDone }: { postId: string; label: string; tags: Tag[]; initial: string[]; setPostTags: SetPostTags; onDone: () => void }) {
  const t = useTranslations('pages.account.posts');
  const tErr = useTranslations('pages.tags.errors');
  const [picked, setPicked] = useState<string[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setPostTags(postId, picked);
          if (r.ok) onDone();
          else setError(tErr(r.error));
        });
      }}
    >
      <ResponsiveDialogHeader>
        <ResponsiveDialogTitle>{t('tagTitle')}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="truncate">{label}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('noTags')}{' '}
          <Link href="/tags" className="font-medium text-primary underline-offset-4 hover:underline">
            {t('manageTags')}
          </Link>
        </p>
      ) : (
        <fieldset className="grid max-h-[50dvh] gap-2 overflow-y-auto">
          <legend className="sr-only">{t('tagTitle')}</legend>
          {tags.map((tag) => {
            const on = picked.includes(tag.id);
            return (
              <label key={tag.id} className="flex min-w-0 items-center gap-2">
                <Checkbox checked={on} disabled={!on && picked.length >= MAX_TAGS_PER_POST} onCheckedChange={(v) => toggle(tag.id, v === true)} />
                <TagBadge tag={tag} />
              </label>
            );
          })}
        </fieldset>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ResponsiveDialogFooter>
        <ResponsiveDialogClose asChild>
          <Button type="button" variant="outline">
            {t('cancel')}
          </Button>
        </ResponsiveDialogClose>
        <LoadingButton type="submit" pending={pending} disabled={tags.length === 0}>
          {t('save')}
        </LoadingButton>
      </ResponsiveDialogFooter>
    </form>
  );
}

/** Edit button + dialog with one checkbox per tag. Saving replaces the post's tags (setPostTagsAction). */
export function TagPicker({ postId, label, tags, selected, setPostTags }: { postId: string; label: string; tags: Tag[]; selected: string[]; setPostTags: SetPostTags }) {
  const t = useTranslations('pages.account.posts');
  const [open, setOpen] = useState(false);
  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={t('editTags', { post: label })}>
        {t('edit')}
      </Button>
      <ResponsiveDialogContent>{open ? <PickerForm postId={postId} label={label} tags={tags} initial={selected} setPostTags={setPostTags} onDone={() => setOpen(false)} /> : null}</ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
