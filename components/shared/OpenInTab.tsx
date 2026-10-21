// "Open in a new tab" (Plan 14c): a plain target="_blank" link. Inside the app's tab frames the FrameBridge turns it
// into an app tab (or jumps to the tab that already shows this exact page); anywhere else it is a normal browser tab.
import { AppWindow } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OpenInTab({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" aria-label={label} title={label} className={cn('inline-flex shrink-0 align-middle text-muted-foreground hover:text-foreground', className)}>
      <AppWindow aria-hidden="true" className="size-3.5" />
    </a>
  );
}
