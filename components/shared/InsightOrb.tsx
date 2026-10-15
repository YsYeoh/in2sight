'use client';

// The one "working" visual (creator-toolkit design §3): a glowing orb, three orbiting arcs and a sparkline that draws
// itself. SVG + CSS keyframes only (styles/loading.css), theme tokens only. `decorative` = aria-hidden, for use inside a
// button or link that already announces its busy state; otherwise it is a polite live region with a hidden label.
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type OrbSize = 'xs' | 'md' | 'lg';
const SIZE: Record<OrbSize, string> = { xs: 'size-4', md: 'size-10', lg: 'size-24' };

interface Props {
  size?: OrbSize;
  /** Hidden label for screen readers (default: common.loading). */
  label?: string;
  decorative?: boolean;
  /** Rotating visible captions under the orb (meant for lg). */
  captions?: boolean;
  className?: string;
}

export function InsightOrb({ size = 'md', label, decorative = false, captions = false, className }: Props) {
  const t = useTranslations();
  const gradient = `orb-${useId().replace(/[^a-zA-Z0-9]/g, '')}`; // useId output is not a valid url(#…) fragment as is
  const svg = (
    <svg viewBox="0 0 48 48" data-size={size} aria-hidden="true" focusable="false" className={cn('insight-orb', SIZE[size], decorative && className)}>
      <defs>
        <radialGradient id={gradient} cx="35%" cy="30%" r="75%">
          <stop offset="0%" style={{ stopColor: 'var(--chart-2)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--chart-1)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--chart-3)' }} />
        </radialGradient>
      </defs>
      <circle className="orb-halo" cx="24" cy="24" r="17" style={{ fill: 'var(--chart-1)' }} />
      <circle cx="24" cy="24" r="12" fill={`url(#${gradient})`} />
      <circle className="orb-arc orb-arc-1" cx="24" cy="24" r="16" pathLength={100} strokeDasharray="28 72" style={{ stroke: 'var(--chart-1)' }} />
      <circle className="orb-arc orb-arc-2" cx="24" cy="24" r="19.5" pathLength={100} strokeDasharray="18 82" style={{ stroke: 'var(--chart-2)' }} />
      <circle className="orb-arc orb-arc-3" cx="24" cy="24" r="22.5" pathLength={100} strokeDasharray="10 90" style={{ stroke: 'var(--chart-3)' }} />
      <polyline className="orb-spark" points="17,27 21,24 24,26 28,20 31,22" pathLength={100} style={{ stroke: 'var(--surface)' }} />
    </svg>
  );
  if (decorative) return svg;
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex flex-col items-center gap-2', className)}>
      {svg}
      <span className="sr-only">{label ?? t('common.loading')}</span>
      {captions ? (
        <span aria-hidden="true" className="orb-captions text-sm text-muted-foreground">
          <span>{t('loading.caption1')}</span>
          <span>{t('loading.caption2')}</span>
          <span>{t('loading.caption3')}</span>
        </span>
      ) : null}
    </span>
  );
}
