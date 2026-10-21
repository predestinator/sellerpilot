import { notFound } from 'next/navigation';
import { SimulateButton } from '@/components/SimulateButton';
import { paypal } from '@/lib/paypal';
import { isMockGateway } from '@/lib/paypal/mock';
import { ready } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Stand-in for PayPal's hosted invoice page (mock mode only). */
export default async function MockInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();
  const gw = paypal();
  if (!isMockGateway(gw)) notFound();
  const inv = await gw.getInvoice(id).catch(() => null);
  if (!inv) notFound();
  const cur = inv.detail.currency_code;
  const fmt = (v?: string) => Number(v ?? 0).toLocaleString('en-US', { style: 'currency', currency: cur });
  return (
    <div className="hosted">
      <div className="card">
        <div className="banner">Simulated PayPal invoice page (mock mode). In sandbox mode the buyer pays on PayPal.</div>
        <div className="card-b">
          <div className="muted">{inv.invoicer?.business_name}</div>
          <h2 style={{ margin: '4px 0 2px' }}>Invoice {inv.detail.invoice_number}</h2>
          <div className="muted">Status: {inv.status} · Due {inv.detail.payment_term?.due_date ?? 'on receipt'}</div>
          <table>
            <tbody>
              {inv.items?.map((i, k) => (
                <tr key={k}><td>{i.quantity} × {i.name}</td><td>{fmt((Number(i.unit_amount.value) * Number(i.quantity)).toFixed(2))}</td></tr>
              ))}
              <tr><td><b>Total</b></td><td><b>{fmt(inv.amount?.value)}</b></td></tr>
            </tbody>
          </table>
          {['UNPAID', 'SENT', 'PARTIALLY_PAID'].includes(inv.status ?? '') ? (
            <SimulateButton op="pay_invoice" id={id} label={`Pay ${fmt(inv.due_amount?.value ?? inv.amount?.value)} (simulated)`} />
          ) : (
            <p className="muted">This invoice is {inv.status?.toLowerCase()}.</p>
          )}
        </div>
      </div>
    </div>
  );
}
