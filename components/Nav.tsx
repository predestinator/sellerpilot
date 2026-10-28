'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLive } from './useLive';

const LINKS = [
  { href: '/', label: 'Overview', icon: '◎' },
  { href: '/inbox', label: 'Agent inbox', icon: '✦' },
  { href: '/orders', label: 'Orders & invoices', icon: '▤' },
  { href: '/approvals', label: 'Approvals', icon: '✓' },
  { href: '/activity', label: 'Activity log', icon: '≡' },
];

export function Nav() {
  const path = usePathname();
  const { data } = useLive<{ approvals: { status: string }[] }>('/api/approvals');
  const pending = data?.approvals.filter((a) => a.status === 'pending').length ?? 0;
  return (
    <nav className="nav" aria-label="Main">
      <div className="brand">
        <Logo />
        <div>
          SellerPilot
          <small>AI back office for cross-border sellers</small>
        </div>
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={(l.href === '/' ? path === '/' : path.startsWith(l.href)) ? 'active' : ''}>
          <span aria-hidden>{l.icon}</span>
          {l.label}
          {l.href === '/approvals' && pending > 0 && <span className="badge">{pending}</span>}
        </Link>
      ))}
      <div className="spacer" />
      <div className="foot">MIT licensed.</div>
    </nav>
  );
}

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1f5eff" />
      <path d="M8 19.5c2.5 2.6 5.3 3.4 8.3 2.4 2.4-.8 3.4-2.7 2.6-4.3-.7-1.4-2.4-1.9-4.7-2.4-2.6-.6-4.4-1.6-4.2-3.7.2-2.3 2.9-3.6 6-3.1 1.7.3 3.1 1 4.3 2.1" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M21 21l4 4" stroke="#9fd0ff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
