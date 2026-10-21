/**
 * Real PayPal sandbox implementation of PayPalGateway. Endpoints, bodies and response
 * handling follow PayPal's OpenAPI schemas + quick-start docs (see README "PayPal API map").
 */
import type { CheckoutInput, InvoiceInput } from '../domain';
import { buildInvoiceBody, buildOrderBody, type InvoicerProfile, type ReturnUrls } from './builders';
import { PayPalClient } from './client';
import type { PayPalGateway, SendInvoiceResult } from './gateway';
import {
  findLink, type InvoiceList, type InvoiceNotification, type InvoiceSearch, type LinkDescription,
  type OrderTrackerRequest, type PayPalInvoice, type PayPalOrder, type PayPalRefund, type WebhookHeaders,
} from './types';

const enc = encodeURIComponent;

export type RestGatewayOptions = {
  client: PayPalClient;
  invoicer: InvoicerProfile;
  returnUrls: (reference: string) => ReturnUrls;
  webhookId?: string;
};

export class RestPayPalGateway implements PayPalGateway {
  readonly mode = 'sandbox' as const;
  constructor(private readonly o: RestGatewayOptions) {}

  private get c() {
    return this.o.client;
  }

  async createDraftInvoice(input: InvoiceInput) {
    const body = buildInvoiceBody(input, this.o.invoicer);
    const res = await this.c.request<PayPalInvoice | LinkDescription>('/v2/invoicing/invoices', { method: 'POST', body });
    // The schema documents a full invoice in the 201 body; the quick-start documents a
    // link (`href`) to the new invoice. Handle both, then read back the canonical resource.
    const id = 'id' in res.data && res.data.id ? res.data.id : idFromHref((res.data as LinkDescription).href);
    if (!id) throw new Error('PayPal create invoice: response carried neither id nor href');
    return this.getInvoice(id);
  }

  async sendInvoice(invoiceId: string, n: InvoiceNotification): Promise<SendInvoiceResult> {
    const res = await this.c.request<LinkDescription | undefined>(`/v2/invoicing/invoices/${enc(invoiceId)}/send`, {
      method: 'POST',
      body: { send_to_invoicer: false, send_to_recipient: true, ...n },
    });
    // 200 → sent now, 202 → scheduled. Both return a link_description per the schema.
    // The canonical buyer URL is detail.metadata.recipient_view_url on the invoice.
    let payerUrl = res.data?.href && res.data.rel !== 'self' ? res.data.href : undefined;
    if (!payerUrl) payerUrl = (await this.getInvoice(invoiceId)).detail.metadata?.recipient_view_url;
    return { payerUrl, status: res.status };
  }

  async remindInvoice(invoiceId: string, n: InvoiceNotification) {
    // 204 No Content. PayPal allows up to 2 reminders per invoice per day.
    await this.c.request(`/v2/invoicing/invoices/${enc(invoiceId)}/remind`, { method: 'POST', body: n });
  }

  async cancelInvoice(invoiceId: string, n: InvoiceNotification) {
    await this.c.request(`/v2/invoicing/invoices/${enc(invoiceId)}/cancel`, { method: 'POST', body: n });
  }

  async getInvoice(invoiceId: string) {
    const res = await this.c.request<PayPalInvoice & { id: string }>(`/v2/invoicing/invoices/${enc(invoiceId)}`);
    return res.data;
  }

  async listInvoices(page = 1, pageSize = 50) {
    const res = await this.c.request<InvoiceList>('/v2/invoicing/invoices', {
      query: { page, page_size: pageSize, total_required: true },
    });
    return res.data;
  }

  async searchInvoices(q: InvoiceSearch, page = 1, pageSize = 50) {
    const res = await this.c.request<InvoiceList>('/v2/invoicing/search-invoices', {
      method: 'POST',
      body: q,
      query: { page, page_size: pageSize, total_required: true },
    });
    return res.data;
  }

  async createOrder(input: CheckoutInput, requestId?: string) {
    const ref = input.reference ?? `sp-${Date.now()}`;
    const body = buildOrderBody({ ...input, reference: ref }, this.o.returnUrls(ref), this.o.invoicer.businessName);
    const res = await this.c.request<PayPalOrder>('/v2/checkout/orders', {
      method: 'POST',
      body,
      requestId,
      prefer: 'return=representation',
    });
    return res.data;
  }

  async getOrder(orderId: string) {
    return (await this.c.request<PayPalOrder>(`/v2/checkout/orders/${enc(orderId)}`)).data;
  }

  async captureOrder(orderId: string, requestId?: string) {
    const res = await this.c.request<PayPalOrder>(`/v2/checkout/orders/${enc(orderId)}/capture`, {
      method: 'POST',
      requestId,
      prefer: 'return=representation',
    });
    return res.data;
  }

  async addTracking(orderId: string, t: OrderTrackerRequest) {
    return (await this.c.request<PayPalOrder>(`/v2/checkout/orders/${enc(orderId)}/track`, { method: 'POST', body: t })).data;
  }

  async refundCapture(captureId: string, r: { amount?: { value: string; currency_code: string }; note?: string }, requestId?: string) {
    const res = await this.c.request<PayPalRefund>(`/v2/payments/captures/${enc(captureId)}/refund`, {
      method: 'POST',
      requestId,
      prefer: 'return=representation',
      body: { ...(r.amount ? { amount: r.amount } : {}), ...(r.note ? { note_to_payer: r.note.slice(0, 255) } : {}) },
    });
    return res.data;
  }

  /**
   * POST /v1/notifications/verify-webhook-signature. The event is spliced in as the RAW
   * body string: re-serialising would change the signed bytes and fail verification.
   */
  async verifyWebhookSignature(h: WebhookHeaders, rawBody: string) {
    if (!this.o.webhookId) throw new Error('PAYPAL_WEBHOOK_ID is not configured; cannot verify webhooks');
    const res = await this.c.request<{ verification_status: 'SUCCESS' | 'FAILURE' }>('/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      rawBody: buildVerifyBody(h, this.o.webhookId, rawBody),
    });
    return res.data.verification_status === 'SUCCESS';
  }
}

export function buildVerifyBody(h: WebhookHeaders, webhookId: string, rawBody: string): string {
  const head = JSON.stringify({
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
    webhook_id: webhookId,
  });
  return `${head.slice(0, -1)},"webhook_event":${rawBody.trim()}}`;
}

export function idFromHref(href?: string): string | undefined {
  if (!href) return undefined;
  const last = href.split('?')[0]!.split('/').filter(Boolean).at(-1);
  return last ? decodeURIComponent(last) : undefined;
}

export const payerLinkOf = (o: PayPalOrder) => findLink(o.links, 'payer-action', 'approve');
