/**
 * Webhook helpers. Design rule: never trust the event body's resource shape (PayPal's
 * docs show simplified samples); verify the signature, dedupe by event id, then
 * re-fetch the affected invoice/order from PayPal, which is the source of truth.
 */
import type { WebhookEvent, WebhookHeaders } from './types';

/** Event types we subscribe to (names confirmed on developer.paypal.com webhook event-names page). */
export const SUBSCRIBED_EVENTS = [
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
  'INVOICING.INVOICE.REFUNDED',
  'CHECKOUT.ORDER.APPROVED',
  'CHECKOUT.ORDER.COMPLETED',
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
] as const;

export function readWebhookHeaders(h: Headers): WebhookHeaders | null {
  const get = (k: string) => h.get(k) ?? undefined;
  const v = {
    authAlgo: get('paypal-auth-algo'),
    certUrl: get('paypal-cert-url'),
    transmissionId: get('paypal-transmission-id'),
    transmissionSig: get('paypal-transmission-sig'),
    transmissionTime: get('paypal-transmission-time'),
  };
  return Object.values(v).every(Boolean) ? (v as WebhookHeaders) : null;
}

export type ResourceRef = { kind: 'invoice' | 'order'; id: string } | { kind: 'capture'; id: string; orderId?: string } | null;

/** Which resource an event is about, so the handler can re-fetch it. */
export function resourceRefOf(e: WebhookEvent): ResourceRef {
  const r = e.resource ?? {};
  const id = typeof r.id === 'string' ? r.id : undefined;
  if (e.event_type.startsWith('INVOICING.INVOICE.')) return id ? { kind: 'invoice', id } : null;
  if (e.event_type.startsWith('CHECKOUT.ORDER.')) return id ? { kind: 'order', id } : null;
  if (e.event_type.startsWith('PAYMENT.CAPTURE.')) {
    // Capture resources carry supplementary_data.related_ids.order_id (Orders v2 captures).
    const sd = r.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
    const orderId = sd?.related_ids?.order_id;
    if (orderId) return { kind: 'order', id: orderId };
    // PAYMENT.CAPTURE.REFUNDED carries a *refund* resource; its `up` link points at the
    // capture (/v2/payments/captures/{id}). UNVERIFIED against a live sandbox delivery.
    const links = (r.links as { href: string; rel: string }[] | undefined) ?? [];
    const up = links.find((l) => l.rel === 'up' && l.href.includes('/captures/'))?.href;
    const captureId = up ? up.split('/captures/')[1]?.split(/[/?]/)[0] : undefined;
    if (captureId) return { kind: 'capture', id: captureId };
    return id ? { kind: 'capture', id } : null;
  }
  return null;
}

export function parseEvent(raw: string): WebhookEvent {
  const e = JSON.parse(raw) as WebhookEvent;
  if (!e || typeof e.id !== 'string' || typeof e.event_type !== 'string') throw new Error('Not a PayPal webhook event');
  return e;
}
