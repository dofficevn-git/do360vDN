import type { Metadata } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const sans = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DO360 cấp xã',
  description: 'Tổng hợp số liệu và sinh báo cáo tự động cho UBND cấp xã',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={sans.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
