import type { ReactNode } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Frame for a chart: title, optional subtitle and actions, a screen-reader summary, and an optional data table
 * fallback (collapsed) so every chart's numbers are reachable without the graphic.
 */
export function ChartCard({ title, subtitle, actions, summary, table, tableLabel, children }: { title: string; subtitle?: string; actions?: ReactNode; summary?: string; table?: ReactNode; tableLabel?: string; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-[length:var(--fh)] font-medium">
          <h2>{title}</h2>
        </CardTitle>
        {subtitle ? <CardDescription className="text-xs">{subtitle}</CardDescription> : null}
        {actions ? <CardAction className="max-w-full">{actions}</CardAction> : null}
      </CardHeader>
      <CardContent className="min-w-0">
        <figure className="m-0 min-w-0">
          {children}
          {summary ? <figcaption className="sr-only">{summary}</figcaption> : null}
        </figure>
        {table ? (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">{tableLabel}</summary>
            <div className="mt-2">{table}</div>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
