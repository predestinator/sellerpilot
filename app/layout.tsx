import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/Toasts';
import './globals.css';

export const metadata: Metadata = {
  title: 'SellerPilot: AI back office for cross-border sellers',
  description: 'Paste a chat order; the agent creates the PayPal invoice or checkout, chases payment, captures, ships and refunds, with human approval for risky actions.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
