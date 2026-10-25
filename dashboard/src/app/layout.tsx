import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Onest } from 'next/font/google';
import '@/styles/global.css';

const onest = Onest({ subsets: ['latin', 'cyrillic'], variable: '--font-onest' });

export const metadata: Metadata = {
  title: { default: 'harness', template: '%s · harness' },
  description: 'The local control plane for harness-demo.',
};

interface Props {
  children: ReactNode;
}

export default function RootLayout({ children }: Props) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${onest.variable} bg-background font-sans text-foreground`}>{children}</body>
    </html>
  );
}
