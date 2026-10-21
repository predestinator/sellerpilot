/**
 * Typed subsets of PayPal REST resources that SellerPilot reads or writes.
 * Field names and enums follow PayPal's published OpenAPI schemas:
 *   Invoicing v2  https://developer.paypal.com/api/invoicing/v2/schema.json
 *   Orders v2     https://developer.paypal.com/api/orders/v2/schema.json
 *   Payments v2   https://developer.paypal.com/api/payments/v2/schema.json
 *   Webhooks v1   https://developer.paypal.com/api/webhooks/v1/schema.json
 * Only fields we use are modelled; everything is optional where PayPal marks it read-only.
 */
import type { Money } from '../money';

export type { Money };

export type LinkDescription = { href: string; rel: string; method?: string };

// ── Invoicing v2 ──────────────────────────────────────────────────────────────
export const INVOICE_STATUSES = [
  'DRAFT', 'SENT', 'SCHEDULED', 'PAID', 'MARKED_AS_PAID', 'CANCELLED', 'REFUNDED',
  'PARTIALLY_PAID', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED', 'UNPAID', 'PAYMENT_PENDING',
  'AUTO_CANCELLED', 'PAID_EXTERNAL', 'REFUNDED_EXTERNAL', 'SHARED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type PaymentTermType =
  | 'DUE_ON_RECEIPT' | 'DUE_ON_DATE_SPECIFIED' | 'NET_10' | 'NET_15' | 'NET_30'
  | 'NET_45' | 'NET_60' | 'NET_90' | 'NO_DUE_DATE';

export type InvoiceItem = {
  id?: string;
  name: string;
  description?: string;
  quantity: string;
  unit_amount: Money;
};

export type BillingInfo = {
  business_name?: string;
  name?: { given_name?: string; surname?: string; full_name?: string };
  email_address?: string;
  address?: { country_code?: string };
};

export type PayPalInvoice = {
  id?: string;
  status?: InvoiceStatus;
  detail: {
    currency_code: string;
    invoice_number?: string;
    reference?: string;
    note?: string;
    memo?: string;
    invoice_date?: string;
    payment_term?: { term_type?: PaymentTermType; due_date?: string };
    metadata?: {
      create_time?: string;
      last_update_time?: string;
      first_sent_time?: string;
      last_sent_time?: string;
      recipient_view_url?: string;
      invoicer_view_url?: string;
    };
  };
  invoicer?: { business_name?: string; email_address?: string; name?: { given_name?: string; surname?: string } };
  primary_recipients?: { billing_info?: BillingInfo }[];
  items?: InvoiceItem[];
  amount?: Money & { breakdown?: unknown };
  due_amount?: Money;
  payments?: { paid_amount?: Money; transactions?: { payment_id?: string; payment_date?: string; amount?: Money }[] };
  refunds?: { refund_amount?: Money };
  links?: LinkDescription[];
};

export type InvoiceList = { total_pages?: number; total_items?: number; items?: PayPalInvoice[]; links?: LinkDescription[] };

export type InvoiceNotification = {
  subject?: string;
  note?: string;
  send_to_invoicer?: boolean;
  send_to_recipient?: boolean;
};

export type InvoiceSearch = {
  recipient_email?: string;
  status?: InvoiceStatus[];
  currency_code?: string;
  reference?: string;
};

// ── Orders v2 ─────────────────────────────────────────────────────────────────
export type OrderStatus = 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';

export type OrderItem = {
  name: string;
  quantity: string;
  unit_amount: Money;
  description?: string;
  sku?: string;
  category?: 'DIGITAL_GOODS' | 'PHYSICAL_GOODS' | 'DONATION';
};

export type OrderRequest = {
  intent: 'CAPTURE' | 'AUTHORIZE';
  purchase_units: {
    reference_id?: string;
    description?: string;
    custom_id?: string;
    invoice_id?: string;
    amount: Money & { breakdown?: { item_total?: Money; shipping?: Money; tax_total?: Money } };
    items?: OrderItem[];
  }[];
  payment_source?: {
    paypal?: {
      email_address?: string;
      experience_context?: {
        brand_name?: string;
        shipping_preference?: 'GET_FROM_FILE' | 'NO_SHIPPING' | 'SET_PROVIDED_ADDRESS';
        landing_page?: 'LOGIN' | 'GUEST_CHECKOUT' | 'NO_PREFERENCE' | 'BILLING';
        user_action?: 'CONTINUE' | 'PAY_NOW';
        payment_method_preference?: 'UNRESTRICTED' | 'IMMEDIATE_PAYMENT_REQUIRED';
        return_url?: string;
        cancel_url?: string;
      };
    };
  };
};

export type PayPalCapture = {
  id: string;
  status: 'COMPLETED' | 'DECLINED' | 'PARTIALLY_REFUNDED' | 'PENDING' | 'REFUNDED' | 'FAILED';
  amount?: Money;
  seller_receivable_breakdown?: { gross_amount?: Money; paypal_fee?: Money; net_amount?: Money };
  create_time?: string;
  links?: LinkDescription[];
  supplementary_data?: { related_ids?: { order_id?: string } };
};

export type PayPalOrder = {
  id: string;
  status: OrderStatus;
  intent?: 'CAPTURE' | 'AUTHORIZE';
  create_time?: string;
  update_time?: string;
  payer?: { email_address?: string; payer_id?: string; name?: { given_name?: string; surname?: string }; address?: { country_code?: string } };
  purchase_units?: {
    reference_id?: string;
    description?: string;
    custom_id?: string;
    invoice_id?: string;
    amount?: Money;
    items?: OrderItem[];
    payments?: { captures?: PayPalCapture[] };
  }[];
  links?: LinkDescription[];
};

export type OrderTrackerRequest = {
  capture_id: string;
  tracking_number?: string;
  carrier?: string; // shipment_carrier enum (e.g. FEDEX, UPS, USPS, DHL, OTHER)
  carrier_name_other?: string;
  notify_payer?: boolean;
};

// ── Payments v2 ───────────────────────────────────────────────────────────────
export type RefundRequest = { amount?: Money; note_to_payer?: string; invoice_id?: string; custom_id?: string };
export type PayPalRefund = {
  id: string;
  status: 'CANCELLED' | 'FAILED' | 'PENDING' | 'COMPLETED';
  amount?: Money;
  note_to_payer?: string;
  create_time?: string;
  links?: LinkDescription[];
};

// ── Webhooks v1 ───────────────────────────────────────────────────────────────
export type WebhookEvent = {
  id: string;
  event_type: string;
  create_time?: string;
  resource_type?: string;
  summary?: string;
  resource?: Record<string, unknown> & { id?: string };
  links?: LinkDescription[];
};

export type WebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export const findLink = (links: LinkDescription[] | undefined, ...rels: string[]) =>
  links?.find((l) => rels.includes(l.rel))?.href;
