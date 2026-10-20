'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { FilterSearch, FilterSelect, FilterToolbar } from '@/components/shared/FilterToolbar';
import { RangeBar } from '@/components/shared/RangeBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DEFAULT_SCOPE, resolveScope } from '@/lib/time-scope/scope';
import { addDays } from '@/lib/sync/time';

const FORMATS = ['REELS', 'CAROUSEL_ALBUM', 'IMAGE'] as const;
const SORTS = ['newest', 'reach'] as const;
const sampleHref = (q: string) => `?${q}`; // links stay on the styleguide

function Piece({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

// The standard pieces (docs/UI_STANDARDS.md) in the current theme, so a theme or density change shows up here first.
export function StandardsGallery({ today }: { today: string }) {
  const s = useTranslations('styleguide.standards');
  const g = useTranslations('styleguide.gallery');
  const ta = useTranslations('pages.account');
  const te = useTranslations('explorer');
  const tf = useTranslations('analysis.format');
  const tx = useTranslations('export');
  const scope = resolveScope(DEFAULT_SCOPE, today, addDays(today, -400));
  return (
    <section className="grid gap-[var(--gp)]">
      <header>
        <h2 className="text-[length:var(--fh)] font-medium">{s('title')}</h2>
        <p className="text-muted-foreground">{s('intro')}</p>
      </header>

      <Piece title={s('rangeBar')}>
        <RangeBar scope={scope} today={today} />
      </Piece>

      <Piece title={s('filterToolbar')}>
        <FilterToolbar
          label={s('filterToolbar')}
          advanced={
            <FilterSelect
              id="sg-format"
              label={te('format')}
              value="REELS"
              options={[{ value: '', label: te('anyFormat') }, ...FORMATS.map((f) => ({ value: f, label: tf(f) }))]}
              hrefFor={(v) => sampleHref(v ? `fmt=${v}` : '')}
            />
          }
          advancedCount={1}
          chips={[{ id: 'fmt', label: tf('REELS'), href: '?' }]}
          clearHref="?"
        >
          <FilterSearch id="sg-search" label={s('sampleSearch')} value="" hrefFor={(q) => sampleHref(q ? `q=${encodeURIComponent(q)}` : '')} />
          <FilterSelect
            id="sg-sort"
            label={s('sampleSort')}
            value="newest"
            options={SORTS.map((v) => ({ value: v, label: s(v === 'newest' ? 'sampleNewest' : 'sampleReach') }))}
            hrefFor={(v) => sampleHref(`sort=${v}`)}
          />
        </FilterToolbar>
      </Piece>

      <Piece title={s('tabs')}>
        <Tabs defaultValue="overview">
          <TabsList variant="line">
            {(['overview', 'posts', 'stories'] as const).map((v) => (
              <TabsTrigger key={v} value={v}>
                {ta(`tab.${v}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {(['overview', 'posts', 'stories'] as const).map((v) => (
            <TabsContent key={v} value={v} className="pt-2 text-muted-foreground">
              {g('tabText')}
            </TabsContent>
          ))}
        </Tabs>
      </Piece>

      <Piece title={s('buttons')}>
        <div role="group" aria-label={s('buttons')} className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline">
            <Download aria-hidden />
            {tx('button')}
          </Button>
          <Button type="button" variant="outline">
            {ta('calendar')}
          </Button>
          <Button type="button" variant="ghost">
            {ta('instagram')}
          </Button>
        </div>
      </Piece>

      <Piece title={s('scrollbar')}>
        <ul className="max-h-40 overflow-y-auto rounded-md border p-2">
          {Array.from({ length: 30 }, (_, i) => (
            <li key={i} className="py-0.5 text-sm">
              {s('row', { n: i + 1 })}
            </li>
          ))}
        </ul>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="w-24 shrink-0 rounded-md border bg-card p-2 text-xs text-muted-foreground">
              {s('row', { n: i + 1 })}
            </div>
          ))}
        </div>
      </Piece>
    </section>
  );
}
