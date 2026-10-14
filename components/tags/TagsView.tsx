'use client';

import { useState, useTransition } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { FormField } from '@/components/shared/FormField';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/shared/ResponsiveDialog';
import { TagBadge } from '@/components/shared/TagBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Tag } from '@/lib/analysis/types';
import type { TagStat } from '@/lib/dashboard/content';
import { formatCompact, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TagResult } from '@/app/(app)/tags/actions';

type Row = TagStat & { id: string; tag: Tag | null }; // tag null = the "Untagged" bucket
export interface TagsViewProps {
  tags: Tag[];
  stats: { rows: ({ tag: Tag } & TagStat)[]; untagged: TagStat };
  create: (name: string) => Promise<TagResult>;
  rename: (id: string, name: string) => Promise<TagResult>;
  remove: (id: string) => Promise<TagResult>;
}

function CreateForm({ create }: { create: TagsViewProps['create'] }) {
  const t = useTranslations('pages.tags');
  const tErr = useTranslations('pages.tags.errors');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex min-w-0 flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await create(name);
          if (r.ok) {
            setName('');
            setError(null);
          } else setError(tErr(r.error));
        });
      }}
    >
      {/* no maxLength: it counts UTF-16 units and would cut 40 emoji at 20; the server checks 40 characters */}
      <FormField id="new-tag" label={t('newTag')} error={error ?? undefined} className="min-w-0 flex-1 basis-48">
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" dir="auto" />}
      </FormField>
      <Button type="submit" disabled={pending || name.trim() === ''}>
        {t('add')}
      </Button>
    </form>
  );
}

function RenameDialog({ tag, rename, onClose }: { tag: Tag | null; rename: TagsViewProps['rename']; onClose: () => void }) {
  const t = useTranslations('pages.tags');
  const tErr = useTranslations('pages.tags.errors');
  const [name, setName] = useState(tag?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <ResponsiveDialog open={tag !== null} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent>
        {tag ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await rename(tag.id, name);
                if (r.ok) onClose();
                else setError(tErr(r.error));
              });
            }}
          >
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{t('renameTitle')}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <FormField id="rename-tag" label={t('name')} error={error ?? undefined}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" dir="auto" />}
            </FormField>
            <ResponsiveDialogFooter>
              <ResponsiveDialogClose asChild>
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              </ResponsiveDialogClose>
              <Button type="submit" disabled={pending}>
                {t('save')}
              </Button>
            </ResponsiveDialogFooter>
          </form>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function TagsView({ tags, stats, create, rename, remove }: TagsViewProps) {
  const t = useTranslations('pages.tags');
  const tm = useTranslations('metrics');
  const ta = useTranslations('analysis');
  const tErr = useTranslations('pages.tags.errors');
  const { prefs } = usePrefs();
  const [renaming, setRenaming] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rows: Row[] = [...stats.rows.map((r) => ({ ...r, id: r.tag.id })), { ...stats.untagged, id: '\u0000untagged', tag: null }];
  const muted = (r: Row) => cn(r.reason && 'text-muted-foreground');
  const columns: Column<Row>[] = [
    { key: 'tag', header: t('tag'), cell: (r) => (r.tag ? <TagBadge tag={r.tag} /> : <span className="text-muted-foreground">{t('untagged')}</span>), sortValue: (r) => r.tag?.name ?? '' },
    { key: 'posts', header: tm('posts'), cell: (r) => formatNumber(r.posts, prefs), sortValue: (r) => r.posts, align: 'right' },
    { key: 'avgReach', header: t('avgReach'), cell: (r) => <span className={muted(r)}>{formatCompact(r.avgReach, prefs)}</span>, sortValue: (r) => r.avgReach, align: 'right' },
    { key: 'er', header: tm('engagementRate'), cell: (r) => <span className={muted(r)}>{formatPercent(r.engagementRate, prefs)}</span>, sortValue: (r) => r.engagementRate, align: 'right' },
    { key: 'note', header: t('note'), cell: (r) => (r.reason ? <span className="text-xs text-muted-foreground">{ta(`reasons.${r.reason}`)}</span> : null) },
    {
      key: 'actions',
      header: t('actions'),
      cell: (r) =>
        r.tag ? (
          <span className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" aria-label={t('renameNamed', { name: r.tag.name })} onClick={() => setRenaming(r.tag)}>
              {t('rename')}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-destructive" aria-label={t('deleteNamed', { name: r.tag.name })} onClick={() => setDeleting(r.tag)}>
              {t('delete')}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid min-w-0 gap-[var(--gp)]">
        <Card className="min-w-0">
          <CardContent>
            <CreateForm create={create} />
          </CardContent>
        </Card>
        {tags.length === 0 ? <EmptyState icon={<TagIcon className="size-5" aria-hidden />} title={t('empty')} description={t('emptyHint')} /> : null}
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} caption={t('caption')} initialSort={{ key: 'avgReach', dir: 'desc' }} />
      </div>
      <RenameDialog key={renaming?.id ?? 'none'} tag={renaming} rename={rename} onClose={() => setRenaming(null)} />
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
    </>
  );
}
