import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { STR } from '../lib/i18n/ru';

export const metadata: Metadata = {
  title: STR.appName,
  description: STR.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
