import { notFound } from 'next/navigation';
import { SimulateButton } from '@/components/SimulateButton';
import { paypal } from '@/lib/paypal';
import { isMockGateway } from '@/lib/paypal/mock';
import { ready } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Stand-in for PayPal's checkout approval page (mock mode only). */
export default async function MockCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();
  const gw = paypal();
  if (!isMockGateway(gw)) notFound();
  const order = await gw.getOrder(id).catch(() => null);
  if (!order) notFound();
  const pu = order.purchase_units?.[0];
  const cur = pu?.amount?.currency_code ?? 'USD';
  const fmt = (v?: string | number) => Number(v ?? 0).toLocaleString('en-US', { style: 'currency', currency: cur });
  return (
    <div className="hosted">
      <div className="card">
        <div className="banner">Simulated PayPal checkout (mock mode). In sandbox mode the buyer approves on PayPal.</div>
        <div className="card-b">
          <h2 style={{ margin: '0 0 2px' }}>{pu?.description}</h2>
          <div className="muted">Order {order.id} · {order.status}</div>
          <table>
            <tbody>
              {pu?.items?.map((i, k) => <tr key={k}><td>{i.quantity} × {i.name}</td><td>{fmt(Number(i.unit_amount.value) * Number(i.quantity))}</td></tr>)}
              <tr><td><b>Total</b></td><td><b>{fmt(pu?.amount?.value)}</b></td></tr>
            </tbody>
          </table>
          {order.status === 'PAYER_ACTION_REQUIRED' || order.status === 'CREATED' ? (
            <SimulateButton op="approve_order" id={id} label="Approve & pay (simulated buyer)" />
          ) : (
            <p className="muted">This order is {order.status.toLowerCase()}.</p>
          )}
        </div>
      </div>
    </div>
  );
}
