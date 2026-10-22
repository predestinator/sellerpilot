'use client';
import Link from 'next/link';
import type { Approval } from '@/lib/db/repo';

export type Summary = {
  collectedUsd: number;
  outstandingUsd: number;
  overdueUsd: number;
  overdueCount: number;
  refundedUsd: number;
  pendingApprovals: number;
  records: number;
  nonUsdOpen: { amount: number; currency: string }[];
};

export const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Compact money summary shared by the overview and the orders dashboard (USD totals; other currencies listed). */
export function KpiStrip({ s, approvals, compact }: { s?: Summary; approvals?: Approval[]; compact?: boolean }) {
  const pending = approvals?.filter((a) => a.status === 'pending') ?? [];
  const heldUsd = pending.filter((a) => (a.currency ?? 'USD') === 'USD').reduce((t, a) => t + (a.amount ?? 0), 0);
  const v = (n?: number) => (n === undefined ? '…' : usd(n));
  return (
    <div className={`kpis ${compact ? 'compact' : ''}`}>
      <div className="card kpi">
        <div className="label">Outstanding</div>
        <div className="value">{v(s?.outstandingUsd)}</div>
        <div className="sub">{s?.nonUsdOpen.length ? `+ ${s.nonUsdOpen.map((x) => `${x.amount} ${x.currency}`).join(', ')}` : 'awaiting buyers'}</div>
      </div>
      <div className="card kpi bad">
        <div className="label">Overdue</div>
        <div className="value">{v(s?.overdueUsd)}</div>
        <div className="sub">{s?.overdueCount ?? 0} invoice(s) past due</div>
      </div>
      <div className="card kpi ok">
        <div className="label">Paid</div>
        <div className="value">{v(s?.collectedUsd)}</div>
        <div className="sub">collected via PayPal</div>
      </div>
      <div className="card kpi">
        <div className="label">Refunded</div>
        <div className="value">{v(s?.refundedUsd)}</div>
        <div className="sub">across captured orders</div>
      </div>
      <div className="card kpi warn">
        <div className="label">Pending approval</div>
        <div className="value">
          {s?.pendingApprovals ?? '…'}
          {heldUsd > 0 && <small>{usd(heldUsd)} held</small>}
        </div>
        <div className="sub"><Link href="/approvals">review queue →</Link></div>
      </div>
    </div>
  );
}
