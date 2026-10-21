/**
 * Tool definitions for the AI SDK agent. Write tools wrap the policy-gated `dispatch`;
 * read tools query the local cache. The model never sees credentials, raw PayPal
 * responses, or a way to bypass the approval queue.
 */
import { tool } from 'ai';
import { z } from 'zod';
import { dispatch, schemas, type ActionName, type DispatchResult } from '../actions';
import { approvals, records } from '../db/repo';
import { daysOverdue, lifecycleOf, type CommerceRecord } from '../domain';
import type { Actor } from './policies';

const brief = (r: CommerceRecord) => ({
  id: r.id,
  kind: r.kind,
  number: r.number,
  customer: r.customerName,
  email: r.customerEmail,
  country: r.country,
  amount: r.amount,
  paid: r.paid,
  refunded: r.refunded,
  currency: r.currency,
  status: r.status,
  lifecycle: lifecycleOf(r),
  dueDate: r.dueDate,
  daysOverdue: daysOverdue(r),
  reminders: r.reminders,
  payerUrl: r.payerUrl,
});

/** Trim dispatch results to what the model needs. */
const forModel = (r: DispatchResult) =>
  r.status === 'done'
    ? { status: r.status, summary: r.summary, ...r.result }
    : r.status === 'pending_approval'
      ? { status: r.status, summary: r.summary, approvalId: r.approvalId, why: r.reasons }
      : r.status === 'denied'
        ? { status: r.status, summary: r.summary, why: r.reasons }
        : { status: r.status, summary: r.summary, error: r.error };

const DESCRIPTIONS: Record<ActionName, string> = {
  create_invoice: 'Create AND send a PayPal invoice (Invoicing v2) to a buyer. Returns the payer link. Large amounts or new customers may be queued for approval.',
  create_checkout: 'Create a PayPal checkout order (Orders v2, intent CAPTURE) and return the buyer approval link to paste into chat.',
  send_reminder: 'Send a PayPal payment reminder for an unpaid invoice. Tone: friendly | firm | final.',
  capture_order: 'Capture payment for a checkout order the buyer has APPROVED.',
  refund_payment: 'Refund a captured checkout order fully or partially (Payments v2 refund).',
  add_tracking: 'Attach a shipment tracking number to a captured checkout order.',
  cancel_invoice: 'Cancel a sent, unpaid invoice (irreversible; always needs approval).',
};

export function buildTools(actor: Actor = 'agent') {
  const writeTools = Object.fromEntries(
    (Object.keys(schemas) as ActionName[]).map((name) => [
      name,
      tool({
        description: DESCRIPTIONS[name],
        inputSchema: schemas[name],
        execute: async (input: unknown) => forModel(await dispatch(name, input, actor)),
      }),
    ]),
  );

  return {
    ...writeTools,
    list_records: tool({
      description: 'List tracked invoices and checkout orders, optionally filtered. Use for "who owes me", "what is overdue", lookups by customer.',
      inputSchema: z.object({
        kind: z.enum(['invoice', 'order']).optional(),
        lifecycle: z.enum(['draft', 'awaiting_payment', 'approved', 'paid', 'refunded', 'cancelled']).optional(),
        customer: z.string().optional().describe('Case-insensitive substring of customer name or email'),
        overdueOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (q) => {
        const c = q.customer?.toLowerCase();
        const rows = records
          .list(q.kind)
          .filter((r) => !q.lifecycle || lifecycleOf(r) === q.lifecycle)
          .filter((r) => !c || r.customerName.toLowerCase().includes(c) || r.customerEmail?.toLowerCase().includes(c))
          .filter((r) => !q.overdueOnly || (lifecycleOf(r) === 'awaiting_payment' && daysOverdue(r) > 0))
          .slice(0, q.limit);
        return { count: rows.length, records: rows.map(brief) };
      },
    }),
    business_summary: tool({
      description: 'Totals for the dashboard: collected, outstanding, overdue, refunds, pending approvals.',
      inputSchema: z.object({}),
      execute: async () => summarize(),
    }),
  };
}

export function summarize() {
  const all = records.list();
  const sum = (rs: CommerceRecord[], f: (r: CommerceRecord) => number) => Math.round(rs.reduce((a, r) => a + f(r), 0) * 100) / 100;
  const usd = all.filter((r) => r.currency === 'USD');
  const open = usd.filter((r) => lifecycleOf(r) === 'awaiting_payment' || lifecycleOf(r) === 'approved');
  const overdue = open.filter((r) => daysOverdue(r) > 0);
  return {
    currencyNote: 'Totals are USD-only; other currencies are listed separately.',
    collectedUsd: sum(usd, (r) => r.paid),
    outstandingUsd: sum(open, (r) => r.amount - r.paid),
    overdueUsd: sum(overdue, (r) => r.amount - r.paid),
    overdueCount: overdue.length,
    refundedUsd: sum(usd, (r) => r.refunded),
    nonUsdOpen: all.filter((r) => r.currency !== 'USD' && lifecycleOf(r) === 'awaiting_payment').map((r) => ({ id: r.id, amount: r.amount, currency: r.currency })),
    pendingApprovals: approvals.list('pending').length,
    records: all.length,
  };
}
