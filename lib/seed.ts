/**
 * Demo data for mock mode: a believable month of cross-border sales for an
 * India-based maker selling to buyers abroad. Uses the mock gateway with a shifted
 * clock so some invoices are genuinely overdue. Never runs in sandbox mode.
 */
import { dispatch } from './actions';
import { config } from './config';
import { audit, records, resetAppData, SqliteMockStore } from './db/repo';
import type { InvoiceInput, CheckoutInput } from './domain';
import { MockPayPalGateway } from './paypal/mock';
import { invoiceToRecord, orderToRecord } from './paypal/normalize';

type SeedInvoice = InvoiceInput & { daysAgo: number; outcome: 'paid' | 'unpaid' | 'cancelled' };
type SeedOrder = CheckoutInput & { daysAgo: number; outcome: 'pending' | 'approved' | 'captured' | 'refunded'; refund?: number; tracking?: string };

const INVOICES: SeedInvoice[] = [
  { daysAgo: 12, outcome: 'paid', customer: { name: 'Maya Chen', email: 'maya.chen@example.com', country: 'US' }, currency: 'USD', dueInDays: 7, items: [{ name: 'Block-print cushion cover', quantity: 2, unitPrice: 28 }, { name: 'Tracked shipping (US)', quantity: 1, unitPrice: 12 }] },
  { daysAgo: 16, outcome: 'unpaid', customer: { name: 'Oliver Hughes', email: 'oliver.h@example.co.uk', country: 'GB' }, currency: 'USD', dueInDays: 7, items: [{ name: 'Custom pet illustration (A4)', quantity: 1, unitPrice: 180 }] },
  { daysAgo: 2, outcome: 'unpaid', customer: { name: 'Sofia Rossi', email: 'sofia.rossi@example.it', country: 'IT' }, currency: 'EUR', dueInDays: 7, items: [{ name: 'Silver jhumka earrings', quantity: 3, unitPrice: 34 }] },
  { daysAgo: 25, outcome: 'unpaid', customer: { name: 'Lukas Becker', email: 'lukas.becker@example.de', country: 'DE' }, currency: 'USD', dueInDays: 7, items: [{ name: 'Indigo dabu table runner', quantity: 1, unitPrice: 65 }] },
  { daysAgo: 9, outcome: 'paid', customer: { name: 'Aisha Rahman', email: 'aisha@example.ae', country: 'AE' }, currency: 'USD', dueInDays: 14, items: [{ name: 'Logo design package', quantity: 1, unitPrice: 250 }] },
  { daysAgo: 20, outcome: 'cancelled', customer: { name: 'Emma Wilson', email: 'emma.w@example.com.au', country: 'AU' }, currency: 'USD', dueInDays: 7, items: [{ name: 'Hand-painted tote', quantity: 1, unitPrice: 42 }] },
  { daysAgo: 10, outcome: 'unpaid', customer: { name: 'Priya Nair', email: 'priya.nair@example.com', country: 'US' }, currency: 'USD', dueInDays: 5, items: [{ name: 'Wedding invite suite (50 pcs)', quantity: 1, unitPrice: 140 }] },
];

const ORDERS: SeedOrder[] = [
  { daysAgo: 6, outcome: 'captured', tracking: 'EZ123456789IN', customer: { name: 'Jake Morales', email: 'jake.m@example.com', country: 'US' }, currency: 'USD', shipping: 15, items: [{ name: 'Brass diya set', quantity: 1, unitPrice: 55 }] },
  { daysAgo: 1, outcome: 'approved', customer: { name: 'Chloé Martin', email: 'chloe.martin@example.fr', country: 'FR' }, currency: 'USD', shipping: 18, items: [{ name: 'Kantha throw', quantity: 2, unitPrice: 89 }] },
  { daysAgo: 0, outcome: 'pending', customer: { name: 'Noah Kim', email: 'noah.kim@example.com', country: 'US' }, currency: 'USD', items: [{ name: 'Sticker pack — Mumbai streets', quantity: 3, unitPrice: 6 }] },
  { daysAgo: 8, outcome: 'refunded', refund: 30, customer: { name: 'Hannah Schmidt', email: 'hannah.s@example.de', country: 'DE' }, currency: 'USD', shipping: 20, items: [{ name: 'Macramé wall hanging', quantity: 1, unitPrice: 120 }] },
];

export async function seedDemoData(force = false) {
  const c = config();
  if (c.paypal.mode !== 'mock') return { seeded: false, reason: 'sandbox mode: real data comes from PayPal' };
  if (!force && records.count() > 0) return { seeded: false, reason: 'already has data' };
  if (force) resetAppData();
  const store = new SqliteMockStore();
  const invoicer = { businessName: c.paypal.businessName, email: c.paypal.invoicerEmail };
  const at = (daysAgo: number) => new MockPayPalGateway({ store, invoicer, appBaseUrl: c.app.baseUrl, now: () => new Date(Date.now() - daysAgo * 86_400_000) });

  for (const s of INVOICES) {
    const gw = at(s.daysAgo);
    const inv = await gw.createDraftInvoice(s);
    await gw.sendInvoice(inv.id, { send_to_recipient: true });
    if (s.outcome === 'paid') await gw.simulateInvoicePaid(inv.id);
    if (s.outcome === 'cancelled') await gw.cancelInvoice(inv.id, {});
    const full = await gw.getInvoice(inv.id);
    records.upsert({ ...invoiceToRecord(full, 'mock'), country: s.customer.country });
  }
  for (const s of ORDERS) {
    const gw = at(s.daysAgo);
    let o = await gw.createOrder(s);
    if (s.outcome !== 'pending') o = (await gw.simulateBuyerApproval(o.id), await gw.getOrder(o.id));
    if (s.outcome === 'captured' || s.outcome === 'refunded') o = await gw.captureOrder(o.id);
    let refunded = 0;
    if (s.outcome === 'refunded' && s.refund) {
      const cap = o.purchase_units![0]!.payments!.captures![0]!;
      await gw.refundCapture(cap.id, { amount: { value: s.refund.toFixed(2), currency_code: s.currency }, note: 'Partial refund: small colour variation' });
      o = await gw.getOrder(o.id);
      refunded = s.refund;
    }
    records.upsert({ ...orderToRecord(o, 'mock'), customerName: s.customer.name, customerEmail: s.customer.email, country: s.customer.country, items: s.items, refunded, trackingNumber: s.tracking });
  }
  const held = await seedApprovalQueue();
  audit.log({ actor: 'system', action: 'seed_demo_data', outcome: 'done', detail: { invoices: INVOICES.length, orders: ORDERS.length, heldForApproval: held } });
  return { seeded: true, invoices: INVOICES.length, orders: ORDERS.length, heldForApproval: held };
}

/**
 * A few agent/collections requests that the policy engine parks for a human, so the
 * approval queue is populated on first run. They go through the real `dispatch`
 * path (same policy + audit as live use); nothing executes until someone approves.
 */
async function seedApprovalQueue() {
  const byName = (n: string) => records.list().find((r) => r.customerName === n);
  const jake = byName('Jake Morales');
  const lukas = byName('Lukas Becker');
  const results = [
    await dispatch('create_invoice', { customer: { name: 'Daniel Park', email: 'daniel.park@example.com', country: 'US' }, currency: 'USD', dueInDays: 14, items: [{ name: 'Hand-painted mural commission (deposit)', quantity: 1, unitPrice: 500 }], note: 'Deposit for the 6 ft mural we discussed on Instagram.' }, 'agent'),
    ...(jake ? [await dispatch('refund_payment', { orderId: jake.id, amount: jake.paid, reason: 'Diya set arrived dented in transit; full refund.' }, 'agent')] : []),
    ...(lukas ? [await dispatch('send_reminder', { invoiceId: lukas.id, tone: 'final' }, 'collections')] : []),
  ];
  return results.filter((r) => r.status === 'pending_approval').length;
}

let seeding: Promise<unknown> | undefined;
/** Called lazily by read APIs so a fresh checkout shows a populated dashboard. */
export function ensureSeeded() {
  if (!config().app.seedDemoData || config().paypal.mode !== 'mock') return Promise.resolve();
  return (seeding ??= seedDemoData().catch((e) => {
    seeding = undefined;
    throw e;
  }));
}
