import { PrintShell } from '@/components/report/PrintShell';

// The page headless Chromium prints (lib/export/pdf.ts). It is exempt from the session proxy (lib/auth/route-policy.ts)
// and therefore reads NOTHING: no session, no database, no query parameters. It only renders the ReportModel the PDF
// route injected into this window over the DevTools protocol. Opened by anyone else it stays at "Preparing the report…".
export default function PrintPage() {
  return <PrintShell />;
}
