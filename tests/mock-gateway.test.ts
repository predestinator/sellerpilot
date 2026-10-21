import { describe, expect, it } from 'vitest';
import { MemoryMockStore, MockPayPalGateway } from '@/lib/paypal/mock';

const gw = (now?: () => Date) => new MockPayPalGateway({ store: new MemoryMockStore(), invoicer: { businessName: 'T' }, appBaseUrl: 'http://localhost:3000', now });
const input = { customer: { name: 'Ann Lee', email: 'ann@example.com' }, currency: 'USD', items: [{ name: 'Print', quantity: 2, unitPrice: 15 }] };

describe('MockPayPalGateway lifecycle', () => {
  it('invoice: DRAFT → UNPAID → PAID with hosted link', async () => {
    const g = gw();
    const inv = await g.createDraftInvoice(input);
    expect(inv.id).toMatch(/^INV2-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(inv.status).toBe('DRAFT');
    expect(inv.amount).toEqual({ currency_code: 'USD', value: '30.00' });
    const sent = await g.sendInvoice(inv.id, {});
    expect(sent.payerUrl).toBe(`http://localhost:3000/mock-paypal/invoice/${inv.id}`);
    expect((await g.getInvoice(inv.id)).status).toBe('UNPAID');
    const ev = await g.simulateInvoicePaid(inv.id);
    expect(ev.event_type).toBe('INVOICING.INVOICE.PAID');
    expect((await g.getInvoice(inv.id)).payments?.paid_amount?.value).toBe('30.00');
  });

  it('enforces 2 reminders per invoice per day', async () => {
    const g = gw();
    const inv = await g.createDraftInvoice(input);
    await expect(g.remindInvoice(inv.id, {})).rejects.toThrow(/INVALID_INVOICE_STATUS/);
    await g.sendInvoice(inv.id, {});
    await g.remindInvoice(inv.id, {});
    await g.remindInvoice(inv.id, {});
    await expect(g.remindInvoice(inv.id, {})).rejects.toMatchObject({ status: 429 });
  });

  it('order: cannot capture before approval; capture once; idempotent replay by request id', async () => {
    const g = gw();
    const o = await g.createOrder(input, 'req-A');
    expect(o.status).toBe('PAYER_ACTION_REQUIRED');
    expect((await g.createOrder(input, 'req-A')).id).toBe(o.id);
    await expect(g.captureOrder(o.id)).rejects.toMatchObject({ issue: 'ORDER_NOT_APPROVED' });
    await g.simulateBuyerApproval(o.id);
    const c1 = await g.captureOrder(o.id, 'cap-1');
    expect(c1.status).toBe('COMPLETED');
    expect((await g.captureOrder(o.id, 'cap-1')).status).toBe('COMPLETED'); // same request id → replay
    await expect(g.captureOrder(o.id, 'cap-2')).rejects.toMatchObject({ issue: 'ORDER_ALREADY_CAPTURED' });
  });

  it('refunds partially then fully and blocks over-refunds', async () => {
    const g = gw();
    const o = await g.createOrder(input);
    await g.simulateBuyerApproval(o.id);
    const cap = (await g.captureOrder(o.id)).purchase_units![0]!.payments!.captures![0]!;
    await g.refundCapture(cap.id, { amount: { value: '10.00', currency_code: 'USD' } });
    expect((await g.getOrder(o.id)).purchase_units![0]!.payments!.captures![0]!.status).toBe('PARTIALLY_REFUNDED');
    await expect(g.refundCapture(cap.id, { amount: { value: '25.00', currency_code: 'USD' } })).rejects.toMatchObject({ issue: 'REFUND_AMOUNT_EXCEEDED' });
    const r = await g.refundCapture(cap.id, {});
    expect(r.amount?.value).toBe('20.00');
    expect((await g.getOrder(o.id)).purchase_units![0]!.payments!.captures![0]!.status).toBe('REFUNDED');
  });

  it('honours an injected clock for due dates', async () => {
    const g = gw(() => new Date('2026-10-01T10:00:00Z'));
    const inv = await g.createDraftInvoice({ ...input, dueInDays: 7 });
    expect(inv.detail.invoice_date).toBe('2026-10-01');
    expect(inv.detail.payment_term).toEqual({ term_type: 'DUE_ON_DATE_SPECIFIED', due_date: '2026-10-08' });
  });
});
