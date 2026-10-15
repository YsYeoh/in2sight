'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { ReportDocument } from '@/components/report/ReportDocument';
import { isReportModel } from '@/lib/export/report';

declare global {
  interface Window {
    __IN2SIGHT_REPORT__?: unknown; // set by lib/export/pdf.ts before any page script runs
  }
}

const noop = () => () => {};
const injected = () => window.__IN2SIGHT_REPORT__ ?? null;
const none = () => null;

/** Renders the injected model, then marks itself ready two frames later (charts measured and painted) for the PDF. */
export function PrintShell() {
  const t = useTranslations('export.report');
  const raw = useSyncExternalStore(noop, injected, none);
  const model = isReportModel(raw) ? raw : null;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!model) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [model]);
  if (!model) return <p className="p-8 text-sm text-muted-foreground">{t('loading')}</p>;
  return (
    <div data-report-ready={ready ? 'true' : undefined}>
      <ReportDocument model={model} />
    </div>
  );
}
