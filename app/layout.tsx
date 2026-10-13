import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { PrefsProvider } from '@/components/providers/PrefsProvider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { htmlAttrs } from '@/lib/prefs';
import { getPrefs } from '@/lib/prefs.server';
import { setPrefs } from '@/app/actions';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'in2sight',
  description: 'Instagram insights across all your accounts',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const prefs = await getPrefs();
  const messages = await getMessages();
  return (
    <html {...htmlAttrs(prefs)} className={inter.variable}>
      <body>
        <NextIntlClientProvider locale={prefs.locale} messages={messages}>
          <PrefsProvider initial={prefs} persist={setPrefs}>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster position="bottom-right" />
          </PrefsProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
