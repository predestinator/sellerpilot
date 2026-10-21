import { describe, expect, it } from 'vitest';
import { PayPalClient } from '@/lib/paypal/client';
import { buildVerifyBody, idFromHref, payerLinkOf, RestPayPalGateway } from '@/lib/paypal/rest';
import { fakeFetch, res, tokenRoute } from './helpers';

const INV_ID = 'INV2-AAAA-BBBB-CCCC-DDDD';
const invoice = (status: string, extra = {}) => ({
  id: INV_ID,
  status,
  detail: { currency_code: 'USD', invoice_number: '0001', metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${INV_ID}` } },
  primary_recipients: [{ billing_info: { name: { given_name: 'Maya', surname: 'Chen' }, email_address: 'maya@example.com' } }],
  items: [{ name: 'Cushion cover', quantity: '2', unit_amount: { currency_code: 'USD', value: '28.00' } }],
  amount: { currency_code: 'USD', value: '56.00' },
  ...extra,
});

function gateway(routes: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch({ ...tokenRoute, ...routes });
  const client = new PayPalClient({ clientId: 'c', clientSecret: 's', baseUrl: 'https://api-m.sandbox.paypal.com', fetch: f.fn, sleep: async () => {} });
  const gw = new RestPayPalGateway({ client, invoicer: { businessName: 'Studio', email: 'biz@example.com' }, webhookId: 'WH-123', returnUrls: (r) => ({ returnUrl: `https://app/return?ref=${r}`, cancelUrl: `https://app/cancel?ref=${r}` }) });
  return { gw, calls: f.calls };
}
const bodyOf = (calls: { url: string; method: string; body?: string }[], method: string, pathPart: string) => JSON.parse(calls.find((c) => c.method === method && c.url.includes(pathPart))!.body!);

describe('RestPayPalGateway: Invoicing v2', () => {
  it('creates a draft (handles the href-only 201 from the quick-start) and reads it back', async () => {
    const { gw, calls } = gateway({
      'POST /v2/invoicing/invoices': [res(201, { rel: 'self', href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${INV_ID}`, method: 'GET' })],
      [`GET /v2/invoicing/invoices/${INV_ID}`]: [res(200, invoice('DRAFT'))],
    });
    const inv = await gw.createDraftInvoice({ customer: { name: 'Maya Chen', email: 'maya@example.com', country: 'us' }, currency: 'usd', items: [{ name: 'Cushion cover', quantity: 2, unitPrice: 28 }], dueInDays: 7 });
    expect(inv.id).toBe(INV_ID);
    const sent = bodyOf(calls, 'POST', '/v2/invoicing/invoices');
    expect(sent.detail.currency_code).toBe('USD');
    expect(sent.detail.payment_term.term_type).toBe('DUE_ON_DATE_SPECIFIED');
    expect(sent.detail.payment_term.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.invoicer).toEqual({ business_name: 'Studio', email_address: 'biz@example.com' });
    expect(sent.primary_recipients[0].billing_info).toEqual({ name: { given_name: 'Maya', surname: 'Chen' }, email_address: 'maya@example.com', address: { country_code: 'US' } });
    expect(sent.items[0]).toEqual({ name: 'Cushion cover', quantity: '2', unit_amount: { currency_code: 'USD', value: '28.00' } });
  });

  it('also accepts a full invoice in the 201 body', async () => {
    const { gw } = gateway({ 'POST /v2/invoicing/invoices': [res(201, invoice('DRAFT'))], [`GET /v2/invoicing/invoices/${INV_ID}`]: [res(200, invoice('DRAFT'))] });
    expect((await gw.createDraftInvoice({ customer: { name: 'M' }, currency: 'USD', items: [{ name: 'x', quantity: 1, unitPrice: 1 }] })).id).toBe(INV_ID);
  });

  it('sends with notification flags and falls back to recipient_view_url for the payer link', async () => {
    const { gw, calls } = gateway({
      [`POST /v2/invoicing/invoices/${INV_ID}/send`]: [res(200, { rel: 'self', href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${INV_ID}` })],
      [`GET /v2/invoicing/invoices/${INV_ID}`]: [res(200, invoice('UNPAID'))],
    });
    const out = await gw.sendInvoice(INV_ID, { send_to_recipient: false });
    expect(bodyOf(calls, 'POST', '/send')).toEqual({ send_to_invoicer: false, send_to_recipient: false });
    expect(out.payerUrl).toContain('/invoice/p/#');
  });

  it('remind posts the notification and accepts 204', async () => {
    const { gw, calls } = gateway({ [`POST /v2/invoicing/invoices/${INV_ID}/remind`]: [new Response(null, { status: 204 })] });
    await gw.remindInvoice(INV_ID, { subject: 'Reminder', note: 'Hi', send_to_recipient: true });
    expect(bodyOf(calls, 'POST', '/remind')).toEqual({ subject: 'Reminder', note: 'Hi', send_to_recipient: true });
  });

  it('lists with page/page_size/total_required query params', async () => {
    const { gw, calls } = gateway({ 'GET /v2/invoicing/invoices': [res(200, { total_pages: 1, items: [] })] });
    await gw.listInvoices(2, 25);
    expect(calls.at(-1)!.url).toContain('page=2&page_size=25&total_required=true');
  });
});

describe('RestPayPalGateway: Orders v2 + Payments v2', () => {
  const order = { id: '5O190127TN364715T', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'self', href: 'x' }, { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T' }] };

  it('creates a CAPTURE order with item_total/shipping breakdown and redirect experience_context', async () => {
    const { gw, calls } = gateway({ 'POST /v2/checkout/orders': [res(200, order)] });
    const o = await gw.createOrder({ customer: { name: 'Tom', email: 'tom@example.com' }, currency: 'USD', items: [{ name: 'Diya set', quantity: 2, unitPrice: 27.5 }], shipping: 15, reference: 'sp-1' }, 'req-1');
    expect(payerLinkOf(o)).toContain('checkoutnow?token=');
    const call = calls.find((c) => c.url.endsWith('/v2/checkout/orders'))!;
    expect(call.headers['PayPal-Request-Id']).toBe('req-1');
    expect(call.headers.Prefer).toBe('return=representation');
    const b = JSON.parse(call.body!);
    expect(b.intent).toBe('CAPTURE');
    expect(b.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '70.00', breakdown: { item_total: { currency_code: 'USD', value: '55.00' }, shipping: { currency_code: 'USD', value: '15.00' } } });
    expect(b.purchase_units[0].items[0]).toMatchObject({ name: 'Diya set', quantity: '2', unit_amount: { currency_code: 'USD', value: '27.50' } });
    expect(b.payment_source.paypal.experience_context).toMatchObject({ user_action: 'PAY_NOW', return_url: 'https://app/return?ref=sp-1', cancel_url: 'https://app/cancel?ref=sp-1' });
  });

  it('captures and refunds through the documented paths', async () => {
    const { gw, calls } = gateway({
      'POST /v2/checkout/orders/5O190127TN364715T/capture': [res(201, { id: '5O190127TN364715T', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: '8MC585209K746392H', status: 'COMPLETED' }] } }] })],
      'POST /v2/payments/captures/8MC585209K746392H/refund': [res(201, { id: '1JU08902781691411', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' } })],
    });
    const cap = await gw.captureOrder('5O190127TN364715T', 'capture-5O19');
    expect(cap.purchase_units![0]!.payments!.captures![0]!.id).toBe('8MC585209K746392H');
    const refund = await gw.refundCapture('8MC585209K746392H', { amount: { value: '10.00', currency_code: 'USD' }, note: 'Sorry!' }, 'r-1');
    expect(refund.status).toBe('COMPLETED');
    expect(bodyOf(calls, 'POST', '/refund')).toEqual({ amount: { value: '10.00', currency_code: 'USD' }, note_to_payer: 'Sorry!' });
  });

  it('adds tracking with capture_id', async () => {
    const { gw, calls } = gateway({ 'POST /v2/checkout/orders/O1/track': [res(201, { id: 'O1', status: 'COMPLETED' })] });
    await gw.addTracking('O1', { capture_id: 'C1', tracking_number: '443844607820', carrier: 'FEDEX', notify_payer: true });
    expect(bodyOf(calls, 'POST', '/track')).toEqual({ capture_id: 'C1', tracking_number: '443844607820', carrier: 'FEDEX', notify_payer: true });
  });
});

describe('Webhook signature verification', () => {
  const headers = { authAlgo: 'SHA256withRSA', certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT', transmissionId: 't-1', transmissionSig: 'sig==', transmissionTime: '2026-10-21T08:00:00Z' };

  it('splices the raw event bytes verbatim into webhook_event', () => {
    const raw = '{"id":"WH-1",  "event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"C1","amount":{"value":"10.00"}}}';
    const body = buildVerifyBody(headers, 'WH-123', raw);
    expect(body.endsWith(`"webhook_event":${raw}}`)).toBe(true); // whitespace preserved
    const parsed = JSON.parse(body);
    expect(parsed).toMatchObject({ auth_algo: 'SHA256withRSA', webhook_id: 'WH-123', transmission_id: 't-1' });
  });

  it('returns true only on verification_status SUCCESS', async () => {
    const ok = gateway({ 'POST /v1/notifications/verify-webhook-signature': [res(200, { verification_status: 'SUCCESS' })] });
    expect(await ok.gw.verifyWebhookSignature(headers, '{"id":"WH-1","event_type":"X"}')).toBe(true);
    const bad = gateway({ 'POST /v1/notifications/verify-webhook-signature': [res(200, { verification_status: 'FAILURE' })] });
    expect(await bad.gw.verifyWebhookSignature(headers, '{"id":"WH-1","event_type":"X"}')).toBe(false);
  });
});

describe('helpers', () => {
  it('extracts ids from hrefs', () => {
    expect(idFromHref(`https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${INV_ID}`)).toBe(INV_ID);
    expect(idFromHref(undefined)).toBeUndefined();
  });
});
