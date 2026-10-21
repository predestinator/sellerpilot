/**
 * The seam between SellerPilot and PayPal. Two implementations share this contract:
 *  - RestPayPalGateway  → real PayPal sandbox REST calls (lib/paypal/rest.ts)
 *  - MockPayPalGateway  → in-memory simulator that mimics the documented state machine (lib/paypal/mock.ts)
 * Everything above this line (actions, agent tools, UI) is identical in both modes.
 */
import type { CheckoutInput, InvoiceInput } from '../domain';
import type {
  InvoiceList, InvoiceNotification, InvoiceSearch, OrderTrackerRequest, PayPalInvoice,
  PayPalOrder, PayPalRefund, WebhookHeaders,
} from './types';

export type SendInvoiceResult = { payerUrl?: string; status: number };

export interface PayPalGateway {
  readonly mode: 'mock' | 'sandbox';

  // Invoicing v2
  createDraftInvoice(input: InvoiceInput): Promise<PayPalInvoice & { id: string }>;
  sendInvoice(invoiceId: string, n: InvoiceNotification): Promise<SendInvoiceResult>;
  remindInvoice(invoiceId: string, n: InvoiceNotification): Promise<void>;
  cancelInvoice(invoiceId: string, n: InvoiceNotification): Promise<void>;
  getInvoice(invoiceId: string): Promise<PayPalInvoice & { id: string }>;
  listInvoices(page?: number, pageSize?: number): Promise<InvoiceList>;
  searchInvoices(q: InvoiceSearch, page?: number, pageSize?: number): Promise<InvoiceList>;

  // Orders v2
  createOrder(input: CheckoutInput, requestId?: string): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId?: string): Promise<PayPalOrder>;
  addTracking(orderId: string, t: OrderTrackerRequest): Promise<PayPalOrder>;

  // Payments v2
  refundCapture(captureId: string, r: { amount?: { value: string; currency_code: string }; note?: string }, requestId?: string): Promise<PayPalRefund>;

  // Webhooks v1
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
}
