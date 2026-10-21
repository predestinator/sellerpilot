'use client';
import { useState } from 'react';
import type { CommerceRecord } from '@/lib/domain';
import { daysOverdue } from '@/lib/domain';
import type { RowAction } from './grid/renderers';
import { postJson } from './useLive';
import { toastFor, useToast } from './Toasts';

type Dialog = { kind: 'refund' | 'track'; rec: CommerceRecord } | null;

/** Wires grid row buttons to /api/actions (actor = user) with small input dialogs. */
export function useRowActions() {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      toastFor(toast, await postJson('/api/actions', { action, args }));
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const onAction = (a: RowAction, r: CommerceRecord) => {
    if (a === 'open' && r.payerUrl) window.open(r.payerUrl, '_blank', 'noopener');
    else if (a === 'remind') void run('send_reminder', { invoiceId: r.id, tone: daysOverdue(r) >= 14 ? 'final' : daysOverdue(r) >= 7 ? 'firm' : 'friendly' });
    else if (a === 'cancel' && confirm(`Cancel invoice ${r.number ?? r.id} for ${r.customerName}? This cannot be undone.`)) void run('cancel_invoice', { invoiceId: r.id });
    else if (a === 'capture') void run('capture_order', { orderId: r.id });
    else if (a === 'refund' || a === 'track') setDialog({ kind: a, rec: r });
  };

  const element = dialog ? <ActionDialog d={dialog} busy={busy} onClose={() => setDialog(null)} onSubmit={async (action, args) => { await run(action, args); setDialog(null); }} /> : null;
  return { onAction, dialog: element };
}

function ActionDialog({ d, busy, onClose, onSubmit }: { d: NonNullable<Dialog>; busy: boolean; onClose: () => void; onSubmit: (action: string, args: Record<string, unknown>) => Promise<void> }) {
  const max = d.rec.paid - d.rec.refunded;
  const [amount, setAmount] = useState(max.toFixed(2));
  const [reason, setReason] = useState('Refund issued by seller');
  const [num, setNum] = useState('');
  const [carrier, setCarrier] = useState('INDIA_POST');
  return (
    <div className="dialog-bg" onClick={onClose}>
      <div className="dialog card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal>
        <div className="card-h"><h2>{d.kind === 'refund' ? `Refund ${d.rec.customerName}` : `Add tracking for ${d.rec.customerName}`}</h2></div>
        <div className="card-b">
          {d.kind === 'refund' ? (
            <>
              <label>Amount ({d.rec.currency}, max {max.toFixed(2)})</label>
              <input type="number" step="0.01" min="0.01" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <label>Note to buyer</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} />
            </>
          ) : (
            <>
              <label>Tracking number</label>
              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="e.g. EZ123456789IN" />
              <label>Carrier</label>
              <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
                {['INDIA_POST', 'DHL', 'FEDEX', 'UPS', 'USPS', 'ARAMEX', 'BLUEDART', 'DELHIVERY'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </>
          )}
        </div>
        <div className="foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={busy || (d.kind === 'track' && num.length < 3)}
            onClick={() =>
              d.kind === 'refund'
                ? onSubmit('refund_payment', { orderId: d.rec.id, amount: Number(amount), reason })
                : onSubmit('add_tracking', { orderId: d.rec.id, trackingNumber: num.trim(), carrier, notifyPayer: true })
            }
          >
            {d.kind === 'refund' ? 'Refund via PayPal' : 'Add tracking'}
          </button>
        </div>
      </div>
    </div>
  );
}
