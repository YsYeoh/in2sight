import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ForceLight } from '@/components/report/ForceLight';
import '@fontsource/noto-sans-sc/400.css';
import './report.css';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Report pages: no app shell, always light, A4 print rules, bundled Noto Sans SC for Chinese glyphs. */
export default function ReportLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background">
      <ForceLight />
      {children}
    </main>
  );
}
