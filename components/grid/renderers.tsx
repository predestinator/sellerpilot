'use client';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { daysOverdue, lifecycleOf, type CommerceRecord } from '@/lib/domain';

export type RowAction = 'remind' | 'cancel' | 'capture' | 'refund' | 'track' | 'open';
export type GridContext = { onAction: (a: RowAction, r: CommerceRecord) => void };

export const flag = (cc?: string) =>
  cc && /^[A-Z]{2}$/i.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌐';

export function CustomerCell({ data, node }: CustomCellRendererProps<CommerceRecord>) {
  if (!data) return null;
  if (node.rowPinned) return <strong className="cell-total">{data.customerName}</strong>;
  return (
    <div className="cell-customer">
      <span>
        <span aria-hidden>{flag(data.country)}</span> {data.customerName}
      </span>
      {data.customerEmail && <small>{data.customerEmail}</small>}
    </div>
  );
}

export const LIFECYCLE_LABEL: Record<string, string> = {
  draft: 'Draft',
  awaiting_payment: 'Awaiting payment',
  approved: 'Approved · capture',
  paid: 'Paid',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export function StatusCell({ data, node }: CustomCellRendererProps<CommerceRecord>) {
  if (!data?.id || node.rowPinned) return null;
  const lc = lifecycleOf(data);
  const od = lc === 'awaiting_payment' ? daysOverdue(data) : 0;
  return (
    <span title={`PayPal status: ${data.status}`} className={`pill ${od > 0 ? 'overdue' : lc}`}>
      {od > 0 ? `Overdue ${od}d` : data.status === 'PARTIALLY_REFUNDED' ? 'Part-refunded' : LIFECYCLE_LABEL[lc]}
    </span>
  );
}

export function PaidCell({ data }: CustomCellRendererProps<CommerceRecord>) {
  if (!data?.amount) return null;
  const pct = Math.min(100, Math.round(((data.paid - data.refunded) / data.amount) * 100));
  return (
    <div className="cell-progress" title={`${data.paid} paid, ${data.refunded} refunded`}>
      <div className="progress"><span style={{ width: `${Math.max(0, pct)}%`, background: data.refunded > 0 ? '#7a4fd6' : undefined }} /></div>
      <small>{Math.max(0, pct)}%</small>
    </div>
  );
}

export function ActionsCell({ data, node, context, compact }: CustomCellRendererProps<CommerceRecord, unknown, GridContext> & { compact?: boolean }) {
  if (!data?.id || node.rowPinned) return null;
  const go = (a: RowAction) => () => context.onAction(a, data);
  const lc = lifecycleOf(data);
  const buttons: [RowAction, string, string?][] = [];
  if (data.kind === 'invoice' && lc === 'awaiting_payment') buttons.push(['remind', 'Remind']);
  if (data.kind === 'invoice' && lc === 'awaiting_payment' && !compact) buttons.push(['cancel', 'Cancel', 'danger']);
  if (data.kind === 'order' && data.status === 'APPROVED') buttons.push(['capture', 'Capture', 'primary']);
  if (data.kind === 'order' && data.captureId && data.paid - data.refunded > 0) buttons.push(['refund', 'Refund']);
  if (data.kind === 'order' && data.captureId && !data.trackingNumber) buttons.push(['track', 'Track']);
  if (data.payerUrl && (lc === 'awaiting_payment' || lc === 'draft')) buttons.push(['open', 'Pay link ↗', 'ghost']);
  return (
    <div className="cell-actions">
      {buttons.map(([a, label, tone]) => (
        <button key={a} className={`btn sm ${tone ?? ''}`} onClick={go(a)}>
          {label}
        </button>
      ))}
    </div>
  );
}
