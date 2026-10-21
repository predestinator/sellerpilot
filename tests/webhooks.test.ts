import { beforeEach, describe, expect, it } from 'vitest';
import { dispatch } from '@/lib/actions';
import { records } from '@/lib/db/repo';
import { MOCK_SIGNATURE, type MockPayPalGateway } from '@/lib/paypal/mock';
import { readWebhookHeaders, resourceRefOf } from '@/lib/paypal/webhooks';
import { processWebhookEvent } from '@/lib/sync';
import { POST as webhookPOST } from '@/app/api/paypal/webhook/route';
import { freshWorld } from './helpers';

let gw: MockPayPalGateway;
beforeEach(() => {
  gw = freshWorld();
});

const customer = { name: 'Jo Park', email: 'jo@example.com' };

describe('webhook processing', () => {
  it('maps events to the resource to re-fetch', () => {
    expect(resourceRefOf({ id: '1', event_type: 'INVOICING.INVOICE.PAID', resource: { id: 'INV2-1' } })).toEqual({ kind: 'invoice', id: 'INV2-1' });
    expect(resourceRefOf({ id: '2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C1', supplementary_data: { related_ids: { order_id: 'O1' } } } })).toEqual({ kind: 'order', id: 'O1' });
    expect(resourceRefOf({ id: '3', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'R1', links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/C9' }] } })).toEqual({ kind: 'capture', id: 'C9' });
    expect(resourceRefOf({ id: '4', event_type: 'BILLING.PLAN.CREATED', resource: { id: 'P' } })).toBeNull();
  });

  it('INVOICING.INVOICE.PAID updates the record once (idempotent by event id)', async () => {
    const r = await dispatch('create_invoice', { customer, items: [{ name: 'Art', quantity: 1, unitPrice: 40 }] }, 'user');
    if (r.status !== 'done') throw new Error('setup');
    const id = String(r.result.invoiceId);
    const ev = await gw.simulateInvoicePaid(id);
    expect(await processWebhookEvent(ev)).toBe('updated');
    expect(records.get(id)).toMatchObject({ status: 'PAID', paid: 40 });
    expect(await processWebhookEvent(ev)).toBe('duplicate');
  });

  it('CHECKOUT.ORDER.APPROVED triggers a server-side capture', async () => {
    const c = await dispatch('create_checkout', { customer, items: [{ name: 'Mug', quantity: 1, unitPrice: 20 }] }, 'user');
    if (c.status !== 'done') throw new Error('setup');
    const orderId = String(c.result.orderId);
    expect(await processWebhookEvent(await gw.simulateBuyerApproval(orderId))).toBe('captured');
    expect(records.get(orderId)).toMatchObject({ status: 'COMPLETED', paid: 20 });
    expect(records.get(orderId)!.captureId).toBeTruthy();
  });

  it('route: rejects missing headers and bad signatures; accepts a verified event', async () => {
    const r = await dispatch('create_invoice', { customer, items: [{ name: 'Art', quantity: 1, unitPrice: 40 }] }, 'user');
    if (r.status !== 'done') throw new Error('setup');
    const ev = await gw.simulateInvoicePaid(String(r.result.invoiceId));
    const raw = JSON.stringify(ev);
    const h = (sig: string) => ({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://example/cert', 'paypal-transmission-id': 't', 'paypal-transmission-sig': sig, 'paypal-transmission-time': '2026-10-21T00:00:00Z' });
    expect((await webhookPOST(new Request('http://x/api/paypal/webhook', { method: 'POST', body: raw }))).status).toBe(400);
    expect((await webhookPOST(new Request('http://x/api/paypal/webhook', { method: 'POST', body: raw, headers: h('forged') }))).status).toBe(401);
    const ok = await webhookPOST(new Request('http://x/api/paypal/webhook', { method: 'POST', body: raw, headers: h(MOCK_SIGNATURE) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, outcome: 'updated' });
  });

  it('reads the five PayPal transmission headers', () => {
    expect(readWebhookHeaders(new Headers({ 'paypal-auth-algo': 'a' }))).toBeNull();
  });
});
