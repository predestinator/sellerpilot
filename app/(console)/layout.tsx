import type { ReactNode } from 'react';
import { Nav } from '@/components/Nav';

/** Seller console chrome. Buyer-facing pages (/pay, /mock-paypal) live outside this group. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <Nav />
      <div className="main">{children}</div>
    </div>
  );
}
