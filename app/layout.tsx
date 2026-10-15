import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { ServiceWorker } from '@/components/pwa/ServiceWorker';
import { NavigationProgress } from '@/components/shared/NavigationProgress';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { htmlAttrs } from '@/lib/prefs';
import { getPrefs } from '@/lib/prefs.server';
import { themeColor } from '@/lib/pwa';
import { setPrefs } from '@/app/actions';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'in2sight',
  description: 'Instagram insights across all your accounts',
  icons: { apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'in2sight', statusBarStyle: 'default' },
};

// The browser bar follows the chosen theme + mode (PrefsProvider updates the tag on switch).
export async function generateViewport(): Promise<Viewport> {
  return { themeColor: themeColor(await getPrefs()) };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const prefs = await getPrefs();
  const messages = await getMessages();
  return (
    <html {...htmlAttrs(prefs)} className={inter.variable}>
      <body>
        <NextIntlClientProvider locale={prefs.locale} messages={messages}>
          <PrefsProvider initial={prefs} persist={setPrefs}>
            {/* useSearchParams: its own Suspense boundary, so a prerendered page can never fail the build or blank the app */}
            <Suspense fallback={null}>
              <NavigationProgress />
            </Suspense>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster position="bottom-right" />
            <ServiceWorker enabled={process.env.NODE_ENV === 'production'} />
          </PrefsProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
