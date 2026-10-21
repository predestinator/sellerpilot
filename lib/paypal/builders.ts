/**
 * Pure request-body builders. Kept separate from I/O so the exact JSON we send to
 * PayPal is unit-tested against the documented schema shapes.
 */
import type { CheckoutInput, Customer, InvoiceInput } from '../domain';
import { money, sumLines, toMinor, fromMinor } from '../money';
import type { BillingInfo, OrderRequest, PayPalInvoice } from './types';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function splitName(full: string): { given_name?: string; surname?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { given_name: parts[0] };
  return { given_name: parts.slice(0, -1).join(' '), surname: parts.at(-1) };
}

function billingInfo(c: Customer): BillingInfo {
  return {
    name: splitName(c.name),
    ...(c.email ? { email_address: c.email } : {}),
    ...(c.country ? { address: { country_code: c.country.toUpperCase() } } : {}),
  };
}

export type InvoicerProfile = { businessName: string; email?: string };

/** Body for POST /v2/invoicing/invoices (create draft). */
export function buildInvoiceBody(input: InvoiceInput, invoicer: InvoicerProfile, today = new Date()): PayPalInvoice {
  const currency = input.currency.toUpperCase();
  const due = input.dueInDays && input.dueInDays > 0 ? new Date(today.getTime() + input.dueInDays * 86_400_000) : undefined;
  return {
    detail: {
      currency_code: currency,
      invoice_date: isoDate(today),
      ...(input.reference ? { reference: input.reference } : {}),
      ...(input.note ? { note: input.note } : {}),
      memo: 'Created by SellerPilot agent',
      payment_term: due
        ? { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: isoDate(due) }
        : { term_type: 'DUE_ON_RECEIPT' },
    },
    invoicer: {
      business_name: invoicer.businessName,
      ...(invoicer.email ? { email_address: invoicer.email } : {}),
    },
    primary_recipients: [{ billing_info: billingInfo(input.customer) }],
    items: input.items.map((i) => ({
      name: i.name.slice(0, 200),
      ...(i.description ? { description: i.description } : {}),
      quantity: String(i.quantity),
      unit_amount: money(i.unitPrice, currency),
    })),
  };
}

export type ReturnUrls = { returnUrl: string; cancelUrl: string };

/** Body for POST /v2/checkout/orders with intent CAPTURE and a PayPal redirect flow. */
export function buildOrderBody(input: CheckoutInput, urls: ReturnUrls, brandName: string): OrderRequest {
  const currency = input.currency.toUpperCase();
  const itemTotal = sumLines(input.items, currency);
  const shippingMinor = input.shipping ? toMinor(input.shipping, currency) : 0;
  const total = fromMinor(toMinor(itemTotal, currency) + shippingMinor, currency);
  return {
    intent: 'CAPTURE',
    purchase_units: [
      {
        ...(input.reference ? { reference_id: input.reference.slice(0, 256), custom_id: input.reference.slice(0, 127) } : {}),
        description: (input.description ?? `Order for ${input.customer.name}`).slice(0, 127),
        amount: {
          currency_code: currency,
          value: total,
          breakdown: {
            item_total: { currency_code: currency, value: itemTotal },
            ...(shippingMinor ? { shipping: { currency_code: currency, value: fromMinor(shippingMinor, currency) } } : {}),
          },
        },
        items: input.items.map((i) => ({
          name: i.name.slice(0, 127),
          quantity: String(i.quantity),
          unit_amount: money(i.unitPrice, currency),
          category: 'PHYSICAL_GOODS' as const,
        })),
      },
    ],
    payment_source: {
      paypal: {
        ...(input.customer.email ? { email_address: input.customer.email } : {}),
        experience_context: {
          brand_name: brandName.slice(0, 127),
          user_action: 'PAY_NOW',
          shipping_preference: 'GET_FROM_FILE',
          return_url: urls.returnUrl,
          cancel_url: urls.cancelUrl,
        },
      },
    },
  };
}

export function invoiceTotal(input: Pick<InvoiceInput, 'items' | 'currency'>): number {
  return Number(sumLines(input.items, input.currency.toUpperCase()));
}

export function checkoutTotal(input: Pick<CheckoutInput, 'items' | 'currency' | 'shipping'>): number {
  return invoiceTotal(input) + (input.shipping ?? 0);
}
