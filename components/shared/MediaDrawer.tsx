'use client';

// Post / Story detail (creator-toolkit spec §4): the cover, what it is and when (owner timezone, formatted by the
// caller), its key numbers, the Instagram link and extra sections. A bottom sheet on phones, a dialog from md
// (ResponsiveDialog). Opened by its own trigger (asChild): Radix traps focus, closes on Esc and returns focus to it.
// The content mounts only while open, so one drawer per item costs nothing.
import type { ReactElement, ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { MediaThumb, type ThumbMedia } from '@/components/shared/MediaThumb';
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogTrigger } from '@/components/shared/ResponsiveDialog';
import { Button } from '@/components/ui/button';

export interface DrawerStat {
  label: string;
  value: string; // already formatted (lib/format.ts)
}

/**
 * `title`: format · date and time; `description`: the caption snippet or a status line; `children`: extra sections
 * (tags, a Story's views curve); `action`: the primary action next to the Instagram link (Plan 13b: "Open Post Lab").
 */
export function MediaDrawer({
  media,
  title,
  description,
  permalink,
  stats,
  trigger,
  children,
  action,
}: {
  media: ThumbMedia;
  title: string;
  description: string;
  permalink: string | null;
  stats: DrawerStat[];
  trigger: ReactElement;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const t = useTranslations('media');
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>{trigger}</ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="md:max-h-[90dvh] md:max-w-3xl md:overflow-y-auto">
        <div className="grid min-w-0 gap-[var(--gp)] md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <MediaThumb media={media} className="mx-auto w-full max-w-48 md:max-w-none" />
          <div className="grid min-w-0 content-start gap-3">
            <ResponsiveDialogHeader className="min-w-0">
              <ResponsiveDialogTitle className="pr-6">{title}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription dir="auto" className="break-words">
                {description}
              </ResponsiveDialogDescription>
              {media.mediaType === 'CAROUSEL_ALBUM' && media.slides ? <p className="text-xs text-muted-foreground">{t('slides', { count: media.slides })}</p> : null}
            </ResponsiveDialogHeader>
            {stats.length ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
                {stats.map((s) => (
                  <div key={s.label} className="min-w-0">
                    <dt className="truncate text-xs text-muted-foreground">{s.label}</dt>
                    <dd className="truncate font-medium tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {children}
            {permalink || action ? (
              <div className="flex flex-wrap items-center gap-2">
                {action}
                {permalink ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={permalink} target="_blank" rel="noopener noreferrer">
                      <ExternalLink aria-hidden="true" />
                      {t('open')}
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
