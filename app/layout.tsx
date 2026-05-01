import type { Metadata } from 'next';
import { AppToaster } from '@/app/components/app-toaster';
import 'yet-another-react-lightbox/styles.css';
import './globals.css';

const themeInitScript = `
(() => {
  try {
    const key = 'reference-batch-theme-v1';
    const stored = window.localStorage.getItem(key);
    const theme =
      stored === 'dark' || stored === 'light'
        ? stored
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

export const metadata: Metadata = {
  title: 'Referans Toplu Görsel Oluşturucu',
  description: 'Tek bir prompt ve referans görselle birden fazla görsel varyantı üretin.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon.png', type: 'image/png' }
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-icon.png'
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
