/**
 * Live PayPal SANDBOX smoke test. Exercises every flow that can be driven server-side
 * (no buyer approval) through the real RestPayPalGateway, and records actual response shapes.
 *
 *   npm run smoke            # needs PAYPAL_MODE=sandbox + PAYPAL_CLIENT_ID/SECRET in .env
 *
 * Secrets: the client secret and access tokens are never printed. Every logged body passes
 * through redact(), and the OAuth response body is never logged at all.
 * Output: console summary + full JSON report in ../logs/live-smoke-<timestamp>.json
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const f of ['.env', '.env.local']) if (existsSync(f)) process.loadEnvFile(f);

import { loadConfig } from '../lib/config';
import { PayPalClient, PayPalApiError, type FetchLike } from '../lib/paypal/client';
import { RestPayPalGateway, payerLinkOf } from '../lib/paypal/rest';

const BUSINESS = process.env.SMOKE_BUSINESS_EMAIL ?? 'sb-oof2753471588@business.example.com';
const BUYER = process.env.SMOKE_BUYER_EMAIL ?? 'sb-qx72v53480150@personal.example.com';

const cfg = loadConfig({ ...process.env, PAYPAL_INVOICER_EMAIL: process.env.PAYPAL_INVOICER_EMAIL ?? BUSINESS });
if (cfg.paypal.mode !== 'sandbox') {
  console.error('PAYPAL_MODE=sandbox with credentials is required (resolved mode: %s)', cfg.paypal.mode);
  process.exit(2);
}
const SECRETS = [cfg.paypal.clientSecret!].filter(Boolean);
const tokens: string[] = [];

function redact(s: string): string {
  let out = s;
  for (const t of [...SECRETS, ...tokens]) if (t) out = out.split(t).join('<redacted>');
  return out.replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"<redacted>"').replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer <redacted>');
}

type Call = { method: string; path: string; status: number; debugId?: string | null; body?: unknown };
const calls: Call[] = [];

/** Wraps fetch to capture every raw response (status + redacted body) for the report. */
const recordingFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init);
  const path = url.replace(cfg.paypal.apiBase, '');
  const text = await res.clone().text();
  if (path.startsWith('/v1/oauth2/token')) {
    try {
      const j = JSON.parse(text) as { access_token?: string; scope?: string; expires_in?: number; app_id?: string };
      if (j.access_token) tokens.push(j.access_token);
      calls.push({ method: 'POST', path, status: res.status, body: { scopes: j.scope?.split(' ').length, expires_in: j.expires_in, app_id: j.app_id } });
    } catch {
      calls.push({ method: 'POST', path, status: res.status });
    }
    return res;
  }
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(redact(text));
    } catch {
      body = redact(text).slice(0, 500);
    }
  }
  calls.push({ method: init?.method ?? 'GET', path, status: res.status, debugId: res.headers.get('paypal-debug-id'), body });
  return res;
};

const client = new PayPalClient({
  clientId: cfg.paypal.clientId!,
  clientSecret: cfg.paypal.clientSecret!,
  baseUrl: cfg.paypal.apiBase,
  fetch: recordingFetch,
  maxAttempts: 3,
});
const gw = new RestPayPalGateway({
  client,
  invoicer: { businessName: cfg.paypal.businessName, email: cfg.paypal.invoicerEmail },
  webhookId: cfg.paypal.webhookId,
  returnUrls: (ref) => ({
    returnUrl: `${cfg.app.baseUrl}/api/paypal/return?ref=${encodeURIComponent(ref)}`,
    cancelUrl: `${cfg.app.baseUrl}/api/paypal/cancel?ref=${encodeURIComponent(ref)}`,
  }),
});

type Step = { name: string; ok: boolean; result?: unknown; error?: unknown };
const steps: Step[] = [];

async function step<T>(name: string, fn: () => Promise<T>, expectError = false): Promise<T | undefined> {
  try {
    const r = await fn();
    steps.push({ name, ok: !expectError, result: r });
    console.log(`${expectError ? 'UNEXPECTED-OK' : 'OK  '} ${name}\n     ${redact(JSON.stringify(r))}`);
    return r;
  } catch (e) {
    const err = e instanceof PayPalApiError
      ? { status: e.status, path: e.path, issue: e.issue, debugId: e.debugId, message: redact(e.message), details: e.details }
      : { message: redact(String((e as Error)?.message ?? e)) };
    steps.push({ name, ok: expectError, error: err });
    console.log(`${expectError ? 'OK (expected error)' : 'FAIL'} ${name}\n     ${redact(JSON.stringify(err))}`);
    return undefined;
  }
}

const lastCall = (pathPart: string, method?: string) =>
  [...calls].reverse().find((c) => c.path.includes(pathPart) && (!method || c.method === method));

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ref = `smoke-${Date.now()}`;

  // 0. OAuth
  await step('0. OAuth client_credentials token', async () => {
    await client.accessToken(true);
    return lastCall('/v1/oauth2/token')?.body;
  });

  // 1a. Invoice with recipient email: create draft -> send -> get
  const inv = await step('1a. createDraftInvoice (recipient email = buyer sandbox)', async () => {
    const i = await gw.createDraftInvoice({
      customer: { name: 'Smoke Buyer', email: BUYER, country: 'US' },
      currency: 'USD',
      items: [{ name: 'Smoke test tee', quantity: 1, unitPrice: 12.5 }],
      reference: `${ref}-inv`,
      dueInDays: 7,
    });
    const create = lastCall('/v2/invoicing/invoices', 'POST');
    return { createHttp: create?.status, createBody: create?.body, id: i.id, number: i.detail?.invoice_number, status: i.status, recipient_view_url: i.detail?.metadata?.recipient_view_url ?? null };
  });
  if (inv?.id) {
    await step('1b. sendInvoice (send_to_recipient: true)', async () => {
      const r = await gw.sendInvoice(inv.id, { subject: 'SellerPilot smoke invoice', note: 'Sandbox smoke test' });
      const send = lastCall(`/${inv.id}/send`, 'POST');
      return { http: r.status, sendBody: send?.body, payerUrl: r.payerUrl };
    });
    await step('1c. getInvoice after send', async () => {
      const i = await gw.getInvoice(inv.id);
      return { status: i.status, number: i.detail?.invoice_number, recipient_view_url: i.detail?.metadata?.recipient_view_url, due: i.amount ?? null };
    });
    await step('1d. remindInvoice', async () => {
      await gw.remindInvoice(inv.id, { subject: 'Reminder (smoke)', note: 'Sandbox reminder' });
      return { http: lastCall(`/${inv.id}/remind`, 'POST')?.status };
    });
  }

  // 1e. Invoice with NO recipient email -> send_to_recipient:false (unverified item #1)
  const inv2 = await step('1e. createDraftInvoice (no recipient email)', async () => {
    const i = await gw.createDraftInvoice({
      customer: { name: 'No Email Buyer', country: 'US' },
      currency: 'USD',
      items: [{ name: 'Smoke sticker pack', quantity: 2, unitPrice: 3 }],
      reference: `${ref}-inv2`,
    });
    return { id: i.id, number: i.detail?.invoice_number, status: i.status };
  });
  if (inv2?.id) {
    await step('1f. sendInvoice (no email, send_to_recipient:false)', async () => {
      const r = await gw.sendInvoice(inv2.id, { send_to_recipient: false });
      return { http: r.status, sendBody: lastCall(`/${inv2.id}/send`, 'POST')?.body, payerUrl: r.payerUrl };
    });
    await step('1g. getInvoice (no-email) after send', async () => {
      const i = await gw.getInvoice(inv2.id);
      return { status: i.status, recipient_view_url: i.detail?.metadata?.recipient_view_url };
    });
    await step('1h. cancelInvoice (no-email invoice)', async () => {
      await gw.cancelInvoice(inv2.id, { send_to_recipient: false, send_to_invoicer: false });
      const c = lastCall(`/${inv2.id}/cancel`, 'POST');
      const after = await gw.getInvoice(inv2.id);
      return { http: c?.status, statusAfter: after.status };
    });
  }

  await step('1i. searchInvoices (recipient_email = buyer)', async () => {
    const l = await gw.searchInvoices({ recipient_email: BUYER }, 1, 5);
    return { total_items: l.total_items, firstStatuses: l.items?.map((x) => x.status) };
  });

  // 2. Checkout order (no capture: needs buyer approval)
  const order = await step('2a. createOrder (intent CAPTURE, USD 5.00)', async () => {
    const o = await gw.createOrder({
      customer: { name: 'Smoke Buyer', email: BUYER, country: 'US' },
      currency: 'USD',
      items: [{ name: 'Smoke test mug', quantity: 1, unitPrice: 5 }],
      reference: `${ref}-ord`,
    });
    return { http: lastCall('/v2/checkout/orders', 'POST')?.status, id: o.id, status: o.status, links: o.links, payerAction: payerLinkOf(o), payment_source: (o as { payment_source?: unknown }).payment_source };
  });
  if (order?.id) {
    await step('2b. getOrder', async () => {
      const o = await gw.getOrder(order.id);
      return { status: o.status, intent: o.intent, amount: o.purchase_units?.[0]?.amount };
    });
    await step('2c. captureOrder BEFORE approval (expected to fail)', () => gw.captureOrder(order.id), true);
  }

  // 3. Refund on a non-existent capture: records the real error shape
  await step('3. refundCapture on fake capture id (expected 404)', () =>
    gw.refundCapture('0SMOKE00000000000', { amount: { value: '1.00', currency_code: 'USD' }, note: 'smoke' }), true);

  // 4. Webhooks: list configured webhooks, then call verify with dummy values
  await step('4a. GET /v1/notifications/webhooks', async () => {
    const r = await client.request<{ webhooks?: { id: string; url: string; event_types: { name: string }[] }[] }>('/v1/notifications/webhooks');
    return { count: r.data.webhooks?.length ?? 0, webhooks: r.data.webhooks?.map((w) => ({ id: w.id, url: w.url, events: w.event_types.length })) };
  });
  await step('4b. verify-webhook-signature with gateway (no PAYPAL_WEBHOOK_ID)', () =>
    gw.verifyWebhookSignature({ authAlgo: 'SHA256withRSA', certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-x', transmissionId: 'x', transmissionSig: 'x', transmissionTime: new Date().toISOString() }, '{"id":"WH-x","event_type":"INVOICING.INVOICE.PAID"}'),
    !cfg.paypal.webhookId);
  await step('4c. verify-webhook-signature direct REST with dummy webhook_id', async () => {
    const dummy = new RestPayPalGateway({ client, invoicer: { businessName: 'x' }, webhookId: '0DUMMY000WEBHOOK00', returnUrls: () => ({ returnUrl: 'https://example.com', cancelUrl: 'https://example.com' }) });
    const ok = await dummy.verifyWebhookSignature({ authAlgo: 'SHA256withRSA', certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77', transmissionId: '00000000-0000-0000-0000-000000000000', transmissionSig: 'AAAA', transmissionTime: new Date().toISOString() }, '{"id":"WH-x","event_type":"INVOICING.INVOICE.PAID","resource":{}}');
    return { verified: ok, body: lastCall('/verify-webhook-signature', 'POST')?.body };
  });

  const report = { ranAt: new Date().toISOString(), apiBase: cfg.paypal.apiBase, steps, calls };
  const dir = resolve('..', 'logs');
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `live-smoke-${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(report, null, 2)));
  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} steps as expected. Report: ${file}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redact(String(e?.stack ?? e)));
  process.exit(1);
});
