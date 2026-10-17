'use client';

// The cover of one post / Reel / Story (creator-toolkit spec §4, Phase B). Served ONLY by Plan 11b's owner-only,
// same-origin route /api/media/<id>/cover, and requested only when the cover is stored ('ok'). A fixed-aspect box
// (no layout shift) shows a skeleton until the image has loaded, then the image fades and un-blurs in (motion-safe
// CSS only). 'pending' / 'unavailable' / 'failed' and a load error show a format-icon placeholder: never a broken image.
// Spans only (display set by class), so the thumb is valid inside a <button> (drawer triggers, calendar cells).
import { useState, useSyncExternalStore } from 'react';
import { CircleFadingPlus, Clapperboard, Copy, GalleryHorizontalEnd, Image as ImageIcon, Play, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePrefs } from '@/components/providers/PrefsProvider';
import { formatNumber } from '@/lib/format';
import type { MediaKind } from '@/lib/instagram/parse';
import type { CoverStatus } from '@/lib/sync/covers';
import { cn } from '@/lib/utils';

export interface ThumbMedia {
  id: string;
  mediaType: MediaKind;
  cover?: CoverStatus; // missing = not known to be stored: never requested
  caption?: string | null; // the caption snippet = the alt text (else the format name)
  slides?: number | null; // carousel children count
  expired?: boolean; // a Story that is no longer live: the "Expired" ribbon
}

// spec §4: 4:5 feed image, 9:16 Reels and Stories, 1:1 carousel. A caller's aspect-* class wins (tailwind-merge).
const ASPECT: Record<MediaKind, string> = { IMAGE: 'aspect-[4/5]', CAROUSEL_ALBUM: 'aspect-square', REELS: 'aspect-[9/16]', STORY: 'aspect-[9/16]' };
const ICON: Record<MediaKind, LucideIcon> = { IMAGE: ImageIcon, CAROUSEL_ALBUM: GalleryHorizontalEnd, REELS: Clapperboard, STORY: CircleFadingPlus };
const CHIP = 'absolute flex items-center gap-0.5 rounded-sm bg-background/80 px-1 py-0.5 text-[10px] leading-none font-medium text-foreground';

export const coverSrc = (id: string) => `/api/media/${encodeURIComponent(id)}/cover`;
const noSubscribe = () => () => {};

/** `badges`: format icon, play glyph (Reels), slide count (carousels) and the Expired ribbon; off for tiny thumbs. */
export function MediaThumb({ media, className, badges = true }: { media: ThumbMedia; className?: string; badges?: boolean }) {
  const t = useTranslations('media');
  const ta = useTranslations('analysis');
  const { prefs } = usePrefs();
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  // the <img> is rendered on the client only: an image that finished before hydration would fire load/error before
  // React listens (skeleton forever). The box and the skeleton are server-rendered, so nothing shifts.
  const client = useSyncExternalStore(noSubscribe, () => true, () => false);
  const Icon = ICON[media.mediaType];
  const name = media.caption ?? ta(`format.${media.mediaType}`);
  const shown = media.cover === 'ok' && state !== 'error';
  return (
    <span data-slot="media-thumb" className={cn('relative block overflow-hidden rounded-md bg-muted', ASPECT[media.mediaType], className)}>
      {shown ? (
        <>
          {state === 'loading' ? <span aria-hidden="true" data-slot="skeleton" className="absolute inset-0 bg-accent motion-safe:animate-pulse" /> : null}
          {client ? (
            // eslint-disable-next-line @next/next/no-img-element -- private owner-only route: next/image's optimizer would fetch it without the session and cache it server-side
            <img
              src={coverSrc(media.id)}
              alt={name}
              loading="lazy"
              decoding="async"
              onLoad={() => setState('loaded')}
              onError={() => setState('error')}
              className={cn('absolute inset-0 size-full object-cover motion-safe:transition-[opacity,filter] motion-safe:duration-300', state === 'loaded' ? 'opacity-100' : 'opacity-0 blur-sm')}
            />
          ) : null}
        </>
      ) : (
        <span role="img" aria-label={t('noCover', { name, why: t(`cover.${state === 'error' ? 'error' : (media.cover ?? 'pending')}`) })} className="absolute inset-0 grid place-items-center text-muted-foreground">
          <Icon aria-hidden="true" className="size-1/4 min-h-4 min-w-4" />
        </span>
      )}
      {badges && shown ? (
        <span aria-hidden="true" className={cn(CHIP, 'top-1 left-1')}>
          <Icon className="size-3" />
        </span>
      ) : null}
      {badges && media.mediaType === 'CAROUSEL_ALBUM' && media.slides ? (
        <span aria-hidden="true" className={cn(CHIP, 'top-1 right-1 tabular-nums')}>
          <Copy className="size-3" />
          {formatNumber(media.slides, prefs)}
        </span>
      ) : null}
      {badges && shown && media.mediaType === 'REELS' ? (
        <span aria-hidden="true" className="absolute inset-0 m-auto grid size-8 place-items-center rounded-full bg-background/70 text-foreground">
          <Play className="size-4 translate-x-px fill-current" />
        </span>
      ) : null}
      {badges && media.expired ? <span className="absolute inset-x-0 bottom-0 bg-background/80 py-0.5 text-center text-[10px] font-medium text-foreground">{t('expired')}</span> : null}
    </span>
  );
}
