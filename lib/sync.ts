/**
 * Keeps the local cache aligned with PayPal (source of truth):
 *  - refreshRecord: re-read one invoice/order after an action or webhook
 *  - syncInvoices: page through GET /v2/invoicing/invoices (boot / manual "Sync")
 *  - processWebhookEvent: idempotent handler used by /api/paypal/webhook
 * Orders v2 has no "list orders" endpoint, so only orders created via SellerPilot
 * (already in the cache) are tracked; they are refreshed individually.
 */
import { dispatch } from './actions';
import { records, webhookEvents, audit } from './db/repo';
import { emit } from './events';
import { paypal } from './paypal';
import { invoiceToRecord, orderToRecord } from './paypal/normalize';
import type { WebhookEvent } from './paypal/types';
import { resourceRefOf } from './paypal/webhooks';

export async function refreshRecord(kind: 'invoice' | 'order', id: string) {
  const gw = paypal();
  const prev = records.get(id);
  const rec = kind === 'invoice' ? invoiceToRecord(await gw.getInvoice(id), gw.mode, prev) : orderToRecord(await gw.getOrder(id), gw.mode, prev);
  records.upsert(rec);
  emit({ type: 'record', id });
  return rec;
}

export async function syncInvoices(maxPages = 10) {
  const gw = paypal();
  let n = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await gw.listInvoices(page, 100);
    for (const summary of res.items ?? []) {
      if (!summary.id) continue;
      // The list omits some detail fields; read the full invoice.
      const full = await gw.getInvoice(summary.id);
      records.upsert(invoiceToRecord(full, gw.mode, records.get(summary.id)));
      n++;
    }
    if (page >= (res.total_pages ?? 1)) break;
  }
  const orders = records.list('order').filter((o) => !['COMPLETED', 'VOIDED', 'REFUNDED'].includes(o.status));
  for (const o of orders) await refreshRecord('order', o.id).catch(() => undefined);
  emit({ type: 'audit', action: 'sync', outcome: 'done' });
  return { invoices: n, ordersRefreshed: orders.length };
}

export type WebhookOutcome = 'duplicate' | 'ignored' | 'updated' | 'captured' | 'unknown_resource';

export async function processWebhookEvent(e: WebhookEvent, source: 'paypal' | 'mock' = 'paypal'): Promise<WebhookOutcome> {
  if (!webhookEvents.claim(e.id, e.event_type)) return 'duplicate';
  let outcome: WebhookOutcome = 'ignored';
  try {
    const ref = resourceRefOf(e);
    if (!ref) outcome = 'ignored';
    else if (ref.kind === 'invoice') {
      await refreshRecord('invoice', ref.id);
      outcome = 'updated';
    } else if (ref.kind === 'order') {
      const rec = records.get(ref.id) ? await refreshRecord('order', ref.id) : undefined;
      outcome = rec ? 'updated' : 'unknown_resource';
      // Buyer approved the checkout → capture (policy re-checks status; request id is deterministic).
      if (rec && e.event_type === 'CHECKOUT.ORDER.APPROVED' && rec.status === 'APPROVED') {
        const r = await dispatch('capture_order', { orderId: rec.id }, 'system');
        if (r.status === 'done') outcome = 'captured';
      }
    } else {
      const rec = records.list('order').find((o) => o.captureId === ref.id);
      if (rec) {
        await refreshRecord('order', rec.id);
        outcome = 'updated';
      } else outcome = 'unknown_resource';
    }
    audit.log({ actor: 'webhook', action: e.event_type, target: typeof e.resource?.id === 'string' ? e.resource.id : undefined, outcome });
    webhookEvents.done(e.id, outcome);
    return outcome;
  } catch (err) {
    webhookEvents.release(e.id);
    throw err;
  }
}
