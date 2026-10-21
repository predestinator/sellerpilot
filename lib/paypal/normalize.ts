/** PayPal resource → CommerceRecord for the dashboard cache. */
import type { CommerceRecord } from '../domain';
import { amountOf } from '../money';
import { findLink, type PayPalInvoice, type PayPalOrder } from './types';

export function invoiceToRecord(inv: PayPalInvoice & { id: string }, source: 'mock' | 'sandbox', prev?: CommerceRecord): CommerceRecord {
  const bi = inv.primary_recipients?.[0]?.billing_info;
  const name = bi?.name?.full_name ?? [bi?.name?.given_name, bi?.name?.surname].filter(Boolean).join(' ') ?? '';
  const now = new Date().toISOString();
  return {
    id: inv.id,
    kind: 'invoice',
    number: inv.detail.invoice_number,
    customerName: name || bi?.business_name || bi?.email_address || 'Unknown customer',
    customerEmail: bi?.email_address,
    country: bi?.address?.country_code ?? prev?.country,
    currency: inv.detail.currency_code,
    amount: amountOf(inv.amount),
    paid: amountOf(inv.payments?.paid_amount),
    refunded: amountOf(inv.refunds?.refund_amount) || (prev?.refunded ?? 0),
    status: inv.status ?? 'DRAFT',
    createdAt: inv.detail.metadata?.create_time ?? prev?.createdAt ?? now,
    dueDate: inv.detail.payment_term?.due_date ?? prev?.dueDate,
    payerUrl: inv.detail.metadata?.recipient_view_url ?? prev?.payerUrl,
    reminders: prev?.reminders ?? 0,
    lastReminderAt: prev?.lastReminderAt,
    remindersOnDay: prev?.remindersOnDay,
    items: (inv.items ?? []).map((i) => ({ name: i.name, quantity: Number(i.quantity), unitPrice: amountOf(i.unit_amount) })),
    source,
    updatedAt: now,
  };
}

export function orderToRecord(o: PayPalOrder, source: 'mock' | 'sandbox', prev?: CommerceRecord): CommerceRecord {
  const pu = o.purchase_units?.[0];
  const capture = pu?.payments?.captures?.[0];
  const now = new Date().toISOString();
  const payerName = [o.payer?.name?.given_name, o.payer?.name?.surname].filter(Boolean).join(' ');
  // Surface refund state on the order row: Orders v2 keeps the order COMPLETED, the capture moves.
  const status = capture && (capture.status === 'REFUNDED' || capture.status === 'PARTIALLY_REFUNDED') ? capture.status : o.status;
  return {
    id: o.id,
    kind: 'order',
    number: pu?.reference_id ?? prev?.number,
    customerName: prev?.customerName ?? (payerName || o.payer?.email_address || 'Checkout buyer'),
    customerEmail: o.payer?.email_address ?? prev?.customerEmail,
    country: o.payer?.address?.country_code ?? prev?.country,
    currency: pu?.amount?.currency_code ?? prev?.currency ?? 'USD',
    amount: amountOf(pu?.amount) || (prev?.amount ?? 0),
    paid: capture && capture.status !== 'DECLINED' && capture.status !== 'FAILED' ? amountOf(capture.amount) : 0,
    refunded: prev?.refunded ?? 0,
    status,
    createdAt: o.create_time ?? prev?.createdAt ?? now,
    payerUrl: findLink(o.links, 'payer-action', 'approve') ?? prev?.payerUrl,
    captureId: capture?.id ?? prev?.captureId,
    trackingNumber: prev?.trackingNumber,
    reminders: prev?.reminders ?? 0,
    lastReminderAt: prev?.lastReminderAt,
    remindersOnDay: prev?.remindersOnDay,
    items: (pu?.items ?? prev?.items ?? []).map((i) =>
      'unitPrice' in i ? i : { name: i.name, quantity: Number(i.quantity), unitPrice: amountOf(i.unit_amount) },
    ),
    source,
    updatedAt: now,
  };
}
