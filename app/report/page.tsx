import { notFound } from 'next/navigation';
import { ReportDocument } from '@/components/report/ReportDocument';
import { requireOwner } from '@/lib/auth/require-owner';
import { parseReportParams } from '@/lib/export/params';
import { buildReport } from '@/lib/export/report';
import { openExport } from '@/lib/export/request';

type SearchParams = Record<string, string | string[] | undefined>;

/** The owner's preview of a PDF report (/report?scope=…&period=…&sections=…&title=…&note=…): same component, no Chromium. */
export default async function ReportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireOwner(); // pages check the owner first, like every other page
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one);
  const r = await openExport(q, parseReportParams, new Headers());
  if (!r.ok) notFound(); // bad parameters or an unknown scope: nothing to show
  const { data, params, prefs, today, now } = r.ctx;
  return <ReportDocument model={buildReport(data, params, { today, now, tz: prefs.timezone, weekStart: prefs.weekStart })} />;
}
