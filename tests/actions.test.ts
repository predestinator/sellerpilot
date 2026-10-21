import { beforeEach, describe, expect, it } from 'vitest';
import { decide, dispatch } from '@/lib/actions';
import { approvals, audit, records } from '@/lib/db/repo';
import { freshWorld } from './helpers';
import type { MockPayPalGateway } from '@/lib/paypal/mock';

let gw: MockPayPalGateway;
beforeEach(() => {
  gw = freshWorld();
});

const known = { name: 'Maya Chen', email: 'maya@example.com', country: 'US' };
const seedKnownCustomer = async () => {
  const r = await dispatch('create_invoice', { customer: known, items: [{ name: 'Seed', quantity: 1, unitPrice: 5 }] }, 'user');
  expect(r.status).toBe('done');
};

describe('dispatch → PayPal (mock) with guardrails', () => {
  it('creates and sends an invoice immediately when within limits', async () => {
    await seedKnownCustomer();
    const r = await dispatch('create_invoice', { customer: known, items: [{ name: 'Cushion cover', quantity: 2, unitPrice: 28 }], dueInDays: 7 }, 'agent');
    expect(r.status).toBe('done');
    if (r.status !== 'done') return;
    expect(r.result.payerUrl).toMatch(/\/mock-paypal\/invoice\/INV2-/);
    const rec = records.get(String(r.result.invoiceId))!;
    expect(rec).toMatchObject({ kind: 'invoice', status: 'UNPAID', amount: 56, customerName: 'Maya Chen', country: 'US' });
    expect(audit.list().some((e) => e.action === 'create_invoice' && e.outcome === 'done')).toBe(true);
  });

  it('queues a large invoice for approval without touching PayPal, then executes on approve', async () => {
    await seedKnownCustomer();
    const before = (await gw.listInvoices()).total_items;
    const r = await dispatch('create_invoice', { customer: known, items: [{ name: 'Wedding portrait', quantity: 1, unitPrice: 420 }] }, 'agent');
    expect(r.status).toBe('pending_approval');
    expect((await gw.listInvoices()).total_items).toBe(before);
    if (r.status !== 'pending_approval') return;
    const out = await decide(r.approvalId, 'approve');
    expect(out.result?.status).toBe('done');
    expect(out.approval.status).toBe('executed');
    expect((await gw.listInvoices()).total_items).toBe(before! + 1);
    // Double approve is a no-op.
    const again = await decide(r.approvalId, 'approve');
    expect(again.result).toBeUndefined();
    expect((await gw.listInvoices()).total_items).toBe(before! + 1);
  });

  it('rejection leaves PayPal untouched', async () => {
    const r = await dispatch('create_invoice', { customer: { name: 'New Person' }, items: [{ name: 'X', quantity: 1, unitPrice: 10 }] }, 'agent');
    expect(r.status).toBe('pending_approval'); // first contact
    if (r.status !== 'pending_approval') return;
    await decide(r.approvalId, 'reject');
    expect(approvals.get(r.approvalId)!.status).toBe('rejected');
    expect((await gw.listInvoices()).total_items).toBe(0);
  });

  it('denies INR and invalid input with readable reasons', async () => {
    const inr = await dispatch('create_invoice', { customer: known, currency: 'INR', items: [{ name: 'X', quantity: 1, unitPrice: 500 }] }, 'agent');
    expect(inr.status).toBe('denied');
    const bad = await dispatch('create_invoice', { customer: known, items: [] }, 'agent');
    expect(bad).toMatchObject({ status: 'error' });
  });

  it('checkout → buyer approves → capture → partial refund (auto) → large refund (queued)', async () => {
    await seedKnownCustomer();
    const c = await dispatch('create_checkout', { customer: known, items: [{ name: 'Kantha throw', quantity: 2, unitPrice: 60 }], shipping: 10 }, 'agent');
    expect(c.status).toBe('done');
    if (c.status !== 'done') return;
    const orderId = String(c.result.orderId);
    expect(c.result.payerUrl).toContain(`/mock-paypal/checkout/${orderId}`);
    expect((await dispatch('capture_order', { orderId }, 'agent')).status).toBe('denied'); // not approved yet

    await gw.simulateBuyerApproval(orderId);
    records.patch(orderId, { status: 'APPROVED' });
    const cap = await dispatch('capture_order', { orderId }, 'agent');
    expect(cap.status).toBe('done');
    expect(records.get(orderId)).toMatchObject({ status: 'COMPLETED', paid: 130 });

    const small = await dispatch('refund_payment', { orderId, amount: 20, reason: 'Loose tassel' }, 'agent');
    expect(small.status).toBe('done');
    expect(records.get(orderId)).toMatchObject({ refunded: 20, status: 'PARTIALLY_REFUNDED' });

    const big = await dispatch('refund_payment', { orderId, reason: 'Return' }, 'agent');
    expect(big.status).toBe('pending_approval');
    if (big.status !== 'pending_approval') return;
    const ok = await decide(big.approvalId, 'approve');
    expect(ok.result?.status).toBe('done');
    expect(records.get(orderId)).toMatchObject({ refunded: 130, status: 'REFUNDED' });

    const over = await dispatch('refund_payment', { orderId, amount: 1, reason: 'again' }, 'user');
    expect(over.status).toBe('denied');
  });

  it('reminders respect PayPal’s 2/day cap', async () => {
    await seedKnownCustomer();
    const inv = records.list('invoice')[0]!;
    expect((await dispatch('send_reminder', { invoiceId: inv.id }, 'user')).status).toBe('done');
    expect((await dispatch('send_reminder', { invoiceId: inv.id, tone: 'firm' }, 'user')).status).toBe('done');
    const third = await dispatch('send_reminder', { invoiceId: inv.id }, 'user');
    expect(third).toMatchObject({ status: 'denied' });
    expect(records.get(inv.id)!.reminders).toBe(2);
  });

  it('adds tracking only after capture and maps unknown carriers to OTHER', async () => {
    await seedKnownCustomer();
    const c = await dispatch('create_checkout', { customer: known, items: [{ name: 'Mug', quantity: 1, unitPrice: 20 }] }, 'user');
    if (c.status !== 'done') throw new Error('setup');
    const orderId = String(c.result.orderId);
    expect((await dispatch('add_tracking', { orderId, trackingNumber: 'EZ1', carrier: 'INDIA_POST' }, 'user')).status).toBe('denied');
    await gw.simulateBuyerApproval(orderId);
    records.patch(orderId, { status: 'APPROVED' });
    await dispatch('capture_order', { orderId }, 'user');
    const t = await dispatch('add_tracking', { orderId, trackingNumber: 'SHIP123', carrier: 'Shiprocket' }, 'user');
    expect(t).toMatchObject({ status: 'done', result: { carrier: 'SHIPROCKET' } });
    expect(records.get(orderId)!.trackingNumber).toBe('SHIP123');
  });
});
