import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProxyCopyServer — Config Panel',
  description:
    'Configuration panel for ProxyCopyServer proxy & cache server',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
