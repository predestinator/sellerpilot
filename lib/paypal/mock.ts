/**
 * In-memory PayPal simulator used when no sandbox credentials are configured
 * (and in every unit test). It mirrors the documented lifecycle closely enough to
 * drive the whole product offline:
 *   Invoice: DRAFT → (send) UNPAID → (buyer pays) PAID → (refund) REFUNDED | PARTIALLY_REFUNDED
 *            DRAFT/UNPAID → (cancel) CANCELLED; max 2 reminders per invoice per day.
 *   Order:   PAYER_ACTION_REQUIRED → (buyer approves) APPROVED → (capture) COMPLETED
 * It is NOT PayPal: IDs, URLs and error payloads are shaped like PayPal's, but fees,
 * risk checks and emails are not simulated. Anything mock-only is flagged in STATUS.md.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { CheckoutInput, InvoiceInput } from '../domain';
import { fromMinor, money, toMinor } from '../money';
import { buildInvoiceBody, buildOrderBody, checkoutTotal, invoiceTotal, type InvoicerProfile } from './builders';
import { PayPalApiError } from './client';
import type { PayPalGateway } from './gateway';
import type {
  InvoiceList, InvoiceNotification, InvoiceSearch, OrderTrackerRequest, PayPalCapture,
  PayPalInvoice, PayPalOrder, PayPalRefund, WebhookEvent, WebhookHeaders,
} from './types';

export const MOCK_SIGNATURE = 'sellerpilot-mock-signature';

export interface MockStore {
  get<T>(kind: string, id: string): T | undefined;
  put<T>(kind: string, id: string, value: T): void;
  list<T>(kind: string): T[];
}

export class MemoryMockStore implements MockStore {
  private readonly data = new Map<string, Map<string, unknown>>();
  get<T>(kind: string, id: string) {
    return structuredClone(this.data.get(kind)?.get(id)) as T | undefined;
  }
  put<T>(kind: string, id: string, value: T) {
    if (!this.data.has(kind)) this.data.set(kind, new Map());
    this.data.get(kind)!.set(id, structuredClone(value));
  }
  list<T>(kind: string) {
    return [...(this.data.get(kind)?.values() ?? [])].map((v) => structuredClone(v)) as T[];
  }
}

type Inv = PayPalInvoice & { id: string; _reminders?: string[] };
type CaptureState = PayPalCapture & { _refundedMinor: number; _orderId: string };

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const rand = (n: number) => [...randomBytes(n)].map((b) => ALNUM[b % ALNUM.length]).join('');
const isoSec = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const err = (status: number, path: string, issue: string, message: string) =>
  new PayPalApiError(status, path, JSON.stringify({ name: issue, message, debug_id: `mock-${rand(8).toLowerCase()}`, details: [{ issue, description: message }] }));

export type MockGatewayOptions = {
  store?: MockStore;
  invoicer: InvoicerProfile;
  /** Base for the simulated hosted pages (our own /mock-paypal/* routes). */
  appBaseUrl: string;
  now?: () => Date;
};

export class MockPayPalGateway implements PayPalGateway {
  readonly mode = 'mock' as const;
  private readonly store: MockStore;
  constructor(private readonly o: MockGatewayOptions) {
    this.store = o.store ?? new MemoryMockStore();
  }
  private now() {
    return this.o.now?.() ?? new Date();
  }
  private iso() {
    return isoSec(this.now());
  }

  // ── Invoicing ──────────────────────────────────────────────────────────────
  async createDraftInvoice(input: InvoiceInput) {
    if (!input.items.length) throw err(400, '/v2/invoicing/invoices', 'MISSING_REQUIRED_FIELD', 'items is required');
    const body = buildInvoiceBody(input, this.o.invoicer, this.now());
    const seq = this.store.list('invoice').length + 1;
    const id = `INV2-${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
    const total = money(invoiceTotal(input), input.currency);
    const inv: Inv = {
      ...body,
      id,
      status: 'DRAFT',
      detail: {
        ...body.detail,
        invoice_number: `SP-${String(seq).padStart(4, '0')}`,
        metadata: { create_time: this.iso(), last_update_time: this.iso() },
      },
      amount: total,
      due_amount: total,
      links: [{ href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`, rel: 'self', method: 'GET' }],
    };
    this.store.put('invoice', id, inv);
    return this.getInvoice(id);
  }

  async sendInvoice(invoiceId: string, _n: InvoiceNotification) {
    const inv = this.mustInvoice(invoiceId, 'send');
    if (inv.status !== 'DRAFT') return { payerUrl: inv.detail.metadata?.recipient_view_url, status: 200 }; // resend: no effect
    const url = `${this.o.appBaseUrl}/mock-paypal/invoice/${encodeURIComponent(invoiceId)}`;
    inv.status = 'UNPAID';
    inv.detail.metadata = { ...inv.detail.metadata, first_sent_time: this.iso(), last_sent_time: this.iso(), recipient_view_url: url };
    this.store.put('invoice', invoiceId, inv);
    return { payerUrl: url, status: 200 };
  }

  async remindInvoice(invoiceId: string, _n: InvoiceNotification) {
    const path = `/v2/invoicing/invoices/${invoiceId}/remind`;
    const inv = this.mustInvoice(invoiceId, 'remind');
    if (!['UNPAID', 'SENT', 'PARTIALLY_PAID'].includes(inv.status ?? '')) {
      throw err(422, path, 'INVALID_INVOICE_STATUS', `Cannot remind an invoice in status ${inv.status}`);
    }
    const today = this.now().toISOString().slice(0, 10);
    const sentToday = (inv._reminders ?? []).filter((t) => t.startsWith(today)).length;
    if (sentToday >= 2) throw err(429, path, 'RATE_LIMIT_REACHED', 'Up to 2 reminders per invoice per day');
    inv._reminders = [...(inv._reminders ?? []), this.now().toISOString()];
    this.store.put('invoice', invoiceId, inv);
  }

  async cancelInvoice(invoiceId: string, _n: InvoiceNotification) {
    const inv = this.mustInvoice(invoiceId, 'cancel');
    if (!['UNPAID', 'SENT', 'SCHEDULED'].includes(inv.status ?? '')) {
      throw err(422, `/v2/invoicing/invoices/${invoiceId}/cancel`, 'INVALID_INVOICE_STATUS', `Cannot cancel status ${inv.status}`);
    }
    inv.status = 'CANCELLED';
    this.store.put('invoice', invoiceId, inv);
  }

  async getInvoice(invoiceId: string) {
    const { _reminders, ...inv } = this.mustInvoice(invoiceId, 'get');
    void _reminders;
    return inv;
  }

  async listInvoices(page = 1, pageSize = 50): Promise<InvoiceList> {
    const all = this.store.list<Inv>('invoice').map(({ _reminders, ...i }) => (void _reminders, i));
    return { total_items: all.length, total_pages: Math.max(1, Math.ceil(all.length / pageSize)), items: all.slice((page - 1) * pageSize, page * pageSize) };
  }

  async searchInvoices(q: InvoiceSearch, page = 1, pageSize = 50): Promise<InvoiceList> {
    const all = (await this.listInvoices(1, 10_000)).items ?? [];
    const hits = all.filter(
      (i) =>
        (!q.status?.length || q.status.includes(i.status!)) &&
        (!q.recipient_email || i.primary_recipients?.[0]?.billing_info?.email_address === q.recipient_email) &&
        (!q.currency_code || i.detail.currency_code === q.currency_code) &&
        (!q.reference || i.detail.reference === q.reference),
    );
    return { total_items: hits.length, total_pages: Math.max(1, Math.ceil(hits.length / pageSize)), items: hits.slice((page - 1) * pageSize, page * pageSize) };
  }

  // ── Orders ─────────────────────────────────────────────────────────────────
  async createOrder(input: CheckoutInput, requestId?: string) {
    if (requestId) {
      const prior = this.store.get<string>('idem', `create:${requestId}`);
      if (prior) return this.getOrder(prior); // idempotent replay
    }
    const id = rand(17);
    const ref = input.reference ?? id;
    const body = buildOrderBody({ ...input, reference: ref }, { returnUrl: '', cancelUrl: '' }, this.o.invoicer.businessName);
    const order: PayPalOrder = {
      id,
      status: 'PAYER_ACTION_REQUIRED',
      intent: 'CAPTURE',
      create_time: this.iso(),
      payer: input.customer.email ? { email_address: input.customer.email, name: { given_name: input.customer.name } } : undefined,
      purchase_units: body.purchase_units.map((pu) => ({ ...pu, amount: money(checkoutTotal(input), input.currency) })),
      links: [
        { href: `https://api-m.sandbox.paypal.com/v2/checkout/orders/${id}`, rel: 'self', method: 'GET' },
        { href: `${this.o.appBaseUrl}/mock-paypal/checkout/${id}`, rel: 'payer-action', method: 'GET' },
      ],
    };
    if (input.customer.country) order.payer = { ...order.payer, address: { country_code: input.customer.country.toUpperCase() } };
    this.store.put('order', id, order);
    if (requestId) this.store.put('idem', `create:${requestId}`, id);
    return this.getOrder(id);
  }

  async getOrder(orderId: string) {
    const o = this.store.get<PayPalOrder>('order', orderId);
    if (!o) throw err(404, `/v2/checkout/orders/${orderId}`, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.');
    return o;
  }

  async captureOrder(orderId: string, requestId?: string) {
    const path = `/v2/checkout/orders/${orderId}/capture`;
    if (requestId && this.store.get<string>('idem', `capture:${requestId}`)) return this.getOrder(orderId);
    const o = await this.getOrder(orderId);
    if (o.status === 'COMPLETED') throw err(422, path, 'ORDER_ALREADY_CAPTURED', 'Order already captured.');
    if (o.status !== 'APPROVED') throw err(422, path, 'ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.');
    const pu = o.purchase_units![0]!;
    const capture: CaptureState = {
      id: rand(17),
      status: 'COMPLETED',
      amount: pu.amount,
      create_time: this.iso(),
      supplementary_data: { related_ids: { order_id: orderId } },
      _refundedMinor: 0,
      _orderId: orderId,
    };
    this.store.put('capture', capture.id, capture);
    pu.payments = { captures: [this.publicCapture(capture)] };
    o.status = 'COMPLETED';
    o.update_time = this.iso();
    this.store.put('order', orderId, o);
    if (requestId) this.store.put('idem', `capture:${requestId}`, capture.id);
    return o;
  }

  async addTracking(orderId: string, t: OrderTrackerRequest) {
    const o = await this.getOrder(orderId);
    if (o.status !== 'COMPLETED') throw err(422, `/v2/checkout/orders/${orderId}/track`, 'ORDER_NOT_CAPTURED', 'Order must be captured before tracking can be added.');
    this.store.put('tracker', `${t.capture_id}-${t.tracking_number}`, t);
    return o;
  }

  // ── Payments ───────────────────────────────────────────────────────────────
  async refundCapture(captureId: string, r: { amount?: { value: string; currency_code: string }; note?: string }, requestId?: string) {
    const path = `/v2/payments/captures/${captureId}/refund`;
    if (requestId) {
      const prior = this.store.get<PayPalRefund>('idem', `refund:${requestId}`);
      if (prior) return prior;
    }
    const cap = this.store.get<CaptureState>('capture', captureId);
    if (!cap) throw err(404, path, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.');
    const currency = cap.amount!.currency_code;
    const grossMinor = toMinor(cap.amount!.value, currency);
    const reqMinor = r.amount ? toMinor(r.amount.value, currency) : grossMinor - cap._refundedMinor;
    if (reqMinor <= 0 || cap._refundedMinor + reqMinor > grossMinor) {
      throw err(422, path, 'REFUND_AMOUNT_EXCEEDED', 'The refund amount must be less than or equal to the capture amount that has not yet been refunded.');
    }
    cap._refundedMinor += reqMinor;
    cap.status = cap._refundedMinor === grossMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    this.store.put('capture', captureId, cap);
    const order = await this.getOrder(cap._orderId);
    order.purchase_units![0]!.payments = { captures: [this.publicCapture(cap)] };
    this.store.put('order', order.id, order);
    const refund: PayPalRefund = { id: rand(17), status: 'COMPLETED', amount: { currency_code: currency, value: fromMinor(reqMinor, currency) }, note_to_payer: r.note, create_time: this.iso() };
    if (requestId) this.store.put('idem', `refund:${requestId}`, refund);
    return refund;
  }

  async verifyWebhookSignature(h: WebhookHeaders, _rawBody: string) {
    return h.transmissionSig === MOCK_SIGNATURE;
  }

  // ── Simulator controls (mock only: what the buyer would do on PayPal's pages) ──
  async simulateInvoicePaid(invoiceId: string): Promise<WebhookEvent> {
    const inv = this.mustInvoice(invoiceId, 'pay');
    if (!['UNPAID', 'SENT', 'PARTIALLY_PAID'].includes(inv.status ?? '')) {
      throw err(422, `/mock/invoices/${invoiceId}/pay`, 'INVALID_INVOICE_STATUS', `Invoice is ${inv.status}`);
    }
    inv.status = 'PAID';
    inv.payments = { paid_amount: inv.amount, transactions: [{ payment_id: rand(17), payment_date: this.iso().slice(0, 10), amount: inv.amount }] };
    inv.due_amount = money(0, inv.detail.currency_code);
    this.store.put('invoice', invoiceId, inv);
    return this.event('INVOICING.INVOICE.PAID', 'invoices', { id: invoiceId, status: 'PAID' });
  }

  async simulateBuyerApproval(orderId: string): Promise<WebhookEvent> {
    const o = await this.getOrder(orderId);
    if (o.status !== 'PAYER_ACTION_REQUIRED' && o.status !== 'CREATED') {
      throw err(422, `/mock/orders/${orderId}/approve`, 'ORDER_NOT_APPROVABLE', `Order is ${o.status}`);
    }
    o.status = 'APPROVED';
    o.payer = { ...o.payer, payer_id: o.payer?.payer_id ?? rand(13) };
    this.store.put('order', orderId, o);
    return this.event('CHECKOUT.ORDER.APPROVED', 'checkout-order', { id: orderId, status: 'APPROVED' });
  }

  private publicCapture(c: CaptureState): PayPalCapture {
    const { _refundedMinor, _orderId, ...pub } = c;
    void _refundedMinor; void _orderId;
    return pub;
  }

  private event(event_type: string, resource_type: string, resource: Record<string, unknown>): WebhookEvent {
    return { id: `WH-MOCK-${randomUUID()}`, event_type, resource_type, create_time: this.iso(), resource };
  }

  private mustInvoice(id: string, op: string): Inv {
    const inv = this.store.get<Inv>('invoice', id);
    if (!inv) throw err(404, `/v2/invoicing/invoices/${id}${op === 'get' ? '' : `/${op}`}`, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.');
    return inv;
  }
}

export const isMockGateway = (g: PayPalGateway): g is MockPayPalGateway => g.mode === 'mock';
