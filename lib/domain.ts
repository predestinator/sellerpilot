/**
 * SellerPilot's own domain model. PayPal resources are normalised into
 * `CommerceRecord`s for the grids; PayPal remains the source of truth.
 */
export type LineItem = { name: string; quantity: number; unitPrice: number; description?: string };

export type Customer = { name: string; email?: string; country?: string; handle?: string };

export type InvoiceInput = {
  customer: Customer;
  currency: string;
  items: LineItem[];
  note?: string;
  reference?: string;
  /** Days from today until due. Omit for "due on receipt". */
  dueInDays?: number;
};

export type CheckoutInput = {
  customer: Customer;
  currency: string;
  items: LineItem[];
  shipping?: number;
  description?: string;
  reference?: string;
};

export type RecordKind = 'invoice' | 'order';

export type CommerceRecord = {
  id: string;
  kind: RecordKind;
  number?: string;
  customerName: string;
  customerEmail?: string;
  country?: string;
  currency: string;
  amount: number;
  paid: number;
  refunded: number;
  /** Raw PayPal status (invoice_status or order_status). */
  status: string;
  createdAt: string;
  dueDate?: string;
  payerUrl?: string;
  captureId?: string;
  trackingNumber?: string;
  reminders: number;
  lastReminderAt?: string;
  /** Reminders sent on the UTC day of lastReminderAt (PayPal caps this at 2/day). */
  remindersOnDay?: number;
  items: LineItem[];
  source: 'mock' | 'sandbox';
  updatedAt: string;
};

/** A coarse lifecycle bucket shared by invoices and orders, for colouring and filters. */
export type Lifecycle = 'draft' | 'awaiting_payment' | 'approved' | 'paid' | 'refunded' | 'cancelled';

export function lifecycleOf(r: Pick<CommerceRecord, 'kind' | 'status'>): Lifecycle {
  const s = r.status;
  if (r.kind === 'order') {
    if (s === 'COMPLETED') return 'paid';
    if (s === 'APPROVED') return 'approved';
    if (s === 'VOIDED') return 'cancelled';
    if (s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED') return 'refunded';
    return 'awaiting_payment';
  }
  if (s === 'DRAFT') return 'draft';
  if (['PAID', 'MARKED_AS_PAID', 'PAID_EXTERNAL'].includes(s)) return 'paid';
  if (['REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED', 'REFUNDED_EXTERNAL'].includes(s)) return 'refunded';
  if (['CANCELLED', 'AUTO_CANCELLED'].includes(s)) return 'cancelled';
  return 'awaiting_payment';
}

export function daysOverdue(r: Pick<CommerceRecord, 'dueDate'>, now = new Date()): number {
  if (!r.dueDate) return 0;
  const due = new Date(`${r.dueDate}T23:59:59Z`).getTime();
  return Math.max(0, Math.floor((now.getTime() - due) / 86_400_000));
}

/** Status buckets for the filter chips above the grid (applied before AG Grid's own column filters). */
export type StatusBucket = 'any' | 'open' | 'overdue' | 'paid' | 'refunded' | 'cancelled';

export function inBucket(r: CommerceRecord, b: StatusBucket): boolean {
  const lc = lifecycleOf(r);
  if (b === 'any') return true;
  if (b === 'open') return lc === 'awaiting_payment' || lc === 'approved' || lc === 'draft';
  if (b === 'overdue') return lc === 'awaiting_payment' && daysOverdue(r) > 0;
  if (b === 'paid') return lc === 'paid';
  if (b === 'refunded') return lc === 'refunded';
  return lc === 'cancelled';
}

/** Open balance still owed by the buyer (0 for drafts, paid, refunded or cancelled; matches summarize()). */
export const openBalance = (r: CommerceRecord) => {
  const lc = lifecycleOf(r);
  return lc === 'awaiting_payment' || lc === 'approved' ? Math.max(0, r.amount - r.paid) : 0;
};
