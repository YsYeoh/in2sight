'use client';

// The unsaved-changes guard (Plan 16a, kept small on purpose): a dirty form registers itself; reload / closing the window
// asks through `beforeunload`, the settings section nav asks through confirmLeave(). The shell's own navigation (sidebar,
// tab strip, Back) is NOT guarded: it moves the frame by message (docs/RUNBOOK_SETTINGS.md).
import { useEffect } from 'react';

let dirtyForms = 0; // ponytail: one counter per document; a per-form registry if a page ever needs to name the dirty form

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    dirtyForms++;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // older browsers need it set
    };
    window.addEventListener('beforeunload', ask);
    return () => {
      dirtyForms--;
      window.removeEventListener('beforeunload', ask);
    };
  }, [dirty]);
}

export const hasUnsavedChanges = (): boolean => dirtyForms > 0;

/** true = go ahead (nothing dirty, or the owner confirmed). */
export function confirmLeave(message: string): boolean {
  return !hasUnsavedChanges() || window.confirm(message);
}
