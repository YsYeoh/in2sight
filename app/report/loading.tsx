import { InsightOrb } from '@/components/shared/InsightOrb';

// The report preview has no app shell: a centred lg orb with rotating captions. /report/print renders nothing async,
// so this boundary never shows for the page headless Chromium prints.
export default function ReportLoading() {
  return (
    <div aria-busy="true" className="grid min-h-dvh place-items-center p-[var(--pg)]">
      <InsightOrb size="lg" captions />
    </div>
  );
}
