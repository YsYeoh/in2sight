'use client';

import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { isIos, isStandalone } from '@/lib/pwa';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
const DISMISSED = 'in2sight.installDismissed';

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false; // storage blocked: just show the hint again next time
  }
}

/** A dismissible install hint: the browser's own prompt where it exists (Chrome, Edge, Android), else the iOS steps. */
export function InstallPrompt() {
  const t = useTranslations('pwa.install');
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (dismissedBefore() || isStandalone()) return;
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep the event: the browser's prompt opens only from our button
      setDeferred(e as InstallEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    // iOS has no install event. Deferred a tick: the server render (no hint) must hydrate first, and React wants no
    // synchronous setState inside an effect.
    const ios = isIos() ? setTimeout(() => setIosHint(true), 0) : undefined;
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      clearTimeout(ios);
    };
  }, []);

  if (!deferred && !iosHint) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // storage blocked: hidden for this page view only
    }
    setDeferred(null);
    setIosHint(false);
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => null);
    setDeferred(null); // the event can be used once
  };

  return (
    <section aria-label={t('label')} className="mb-[var(--gp)] flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
      <Download aria-hidden className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{deferred ? t('body') : t('ios')}</p>
      <div className="flex gap-2">
        {deferred ? (
          <Button size="sm" onClick={install}>
            {t('install')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {t('dismiss')}
        </Button>
      </div>
    </section>
  );
}
