/**
 * The action layer: one place where every write to PayPal happens. Agent tools, UI row
 * buttons, the collections loop and approved queue items all call `dispatch`, so policy,
 * idempotency, audit logging and live updates are enforced identically everywhere.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from './config';
import { approvals, audit, records, type Approval } from './db/repo';
import { daysOverdue, lifecycleOf, type CommerceRecord } from './domain';
import { emit } from './events';
import { evaluatePolicy, type Actor, type PolicyFacts } from './agent/policies';
import { paypal, PayPalApiError } from './paypal';
import { checkoutTotal, invoiceTotal } from './paypal/builders';
import { invoiceToRecord, orderToRecord } from './paypal/normalize';
import { payerLinkOf } from './paypal/rest';
import { formatMoney } from './money';

// ── Schemas (shared with the agent tool definitions) ──────────────────────────
const currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'ISO-4217 code, e.g. USD')
  .transform((c) => c.toUpperCase())
  .describe('ISO-4217 currency code. Default USD for cross-border sales.');

const customer = z.object({
  name: z.string().min(1).describe('Buyer full name or handle'),
  email: z.string().email().optional().describe('Buyer email, if known. PayPal emails the invoice when present.'),
  country: z.string().length(2).optional().describe('Buyer ISO-3166 alpha-2 country, e.g. US, GB, DE'),
  handle: z.string().optional().describe('Chat handle the order came from, e.g. @maya.designs'),
});

const lineItem = z.object({
  name: z.string().min(1),
  quantity: z.number().positive().describe('Units'),
  unitPrice: z.number().positive().describe('Price per unit in the invoice currency'),
  description: z.string().optional(),
});

export const schemas = {
  create_invoice: z.object({
    customer,
    currency: currency.default('USD'),
    items: z.array(lineItem).min(1),
    note: z.string().max(4000).optional().describe('Friendly note shown on the invoice'),
    reference: z.string().max(120).optional().describe('Seller reference, e.g. the chat order id'),
    dueInDays: z.number().int().min(0).max(90).optional().describe('Days until due; omit for due on receipt'),
  }),
  create_checkout: z.object({
    customer,
    currency: currency.default('USD'),
    items: z.array(lineItem).min(1),
    shipping: z.number().min(0).optional(),
    description: z.string().max(127).optional(),
    reference: z.string().max(120).optional(),
  }),
  send_reminder: z.object({
    invoiceId: z.string().min(1),
    tone: z.enum(['friendly', 'firm', 'final']).default('friendly'),
    note: z.string().max(1000).optional().describe('Custom reminder text; omitted → tone template'),
  }),
  capture_order: z.object({ orderId: z.string().min(1) }),
  refund_payment: z.object({
    orderId: z.string().min(1).describe('Checkout order id whose capture to refund'),
    amount: z.number().positive().optional().describe('Partial amount; omit for the full remaining amount'),
    reason: z.string().max(255).describe('Shown to the buyer as note_to_payer'),
  }),
  add_tracking: z.object({
    orderId: z.string().min(1),
    trackingNumber: z.string().min(3).max(64),
    carrier: z.string().min(2).max(64).describe('PayPal carrier code, e.g. FEDEX, UPS, USPS, DHL, INDIA_POST, or OTHER'),
    notifyPayer: z.boolean().default(true),
  }),
  cancel_invoice: z.object({ invoiceId: z.string().min(1), note: z.string().max(500).optional() }),
} as const;

export type ActionName = keyof typeof schemas;
export type ActionArgs<A extends ActionName> = z.infer<(typeof schemas)[A]>;
export const ACTION_NAMES = Object.keys(schemas) as ActionName[];

export type DispatchResult =
  | { status: 'done'; action: ActionName; result: Record<string, unknown>; summary: string }
  | { status: 'pending_approval'; action: ActionName; approvalId: string; summary: string; reasons: string[] }
  | { status: 'denied'; action: ActionName; summary: string; reasons: string[] }
  | { status: 'error'; action: ActionName; summary: string; error: string; debugId?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────
const isNewCustomer = (c: { email?: string; name: string }) =>
  (c.email ? records.findByCustomerEmail(c.email) : records.findByCustomerName(c.name)).length === 0;

function mustRecord(id: string, kind?: 'invoice' | 'order'): CommerceRecord {
  const r = records.get(id);
  if (!r || (kind && r.kind !== kind)) throw new Error(`${kind ?? 'Record'} ${id} is not tracked by SellerPilot`);
  return r;
}

export function remindersToday(r: CommerceRecord, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return r.lastReminderAt?.startsWith(today) ? (r.remindersOnDay ?? 1) : 0;
}

const REMINDER_TEMPLATES = {
  friendly: (r: CommerceRecord) => ({
    subject: `Quick reminder: invoice ${r.number ?? ''} from ${config().paypal.businessName}`.trim(),
    note: `Hi ${r.customerName.split(' ')[0]}, just a friendly nudge that ${formatMoney(r.amount - r.paid, r.currency)} is still open. You can pay securely with PayPal or card from the link. Thank you!`,
  }),
  firm: (r: CommerceRecord) => ({
    subject: `Payment overdue: invoice ${r.number ?? ''}`.trim(),
    note: `Hi ${r.customerName.split(' ')[0]}, invoice ${r.number ?? ''} for ${formatMoney(r.amount - r.paid, r.currency)} is now ${daysOverdue(r)} day(s) past due. Please settle it at your earliest convenience so I can ship/deliver on schedule.`,
  }),
  final: (r: CommerceRecord) => ({
    subject: `Final notice: invoice ${r.number ?? ''}`.trim(),
    note: `Hi ${r.customerName.split(' ')[0]}, this is a final reminder that ${formatMoney(r.amount - r.paid, r.currency)} remains unpaid (${daysOverdue(r)} days overdue). If there is an issue with the order, just reply and we will sort it out.`,
  }),
};

// ── Per-action definition: facts for policy, a human summary, and the executor ──
type Def<A extends ActionName> = {
  facts(a: ActionArgs<A>): PolicyFacts;
  summary(a: ActionArgs<A>): { text: string; amount?: number; currency?: string; target?: string };
  run(a: ActionArgs<A>, ctx: { requestId: string }): Promise<Record<string, unknown>>;
};

const defs: { [A in ActionName]: Def<A> } = {
  create_invoice: {
    facts: (a) => ({ action: 'create_invoice', total: invoiceTotal(a), currency: a.currency, newCustomer: isNewCustomer(a.customer), itemCount: a.items.length }),
    summary: (a) => ({ text: `Invoice ${a.customer.name} ${formatMoney(invoiceTotal(a), a.currency)} (${a.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')})`, amount: invoiceTotal(a), currency: a.currency }),
    async run(a) {
      const gw = paypal();
      const draft = await gw.createDraftInvoice(a);
      // No email → move to payable without emailing; the seller shares the link in chat.
      const sent = await gw.sendInvoice(draft.id, { send_to_recipient: Boolean(a.customer.email), send_to_invoicer: false });
      const inv = await gw.getInvoice(draft.id);
      const rec = records.upsert({ ...invoiceToRecord(inv, gw.mode), country: a.customer.country, payerUrl: sent.payerUrl ?? inv.detail.metadata?.recipient_view_url });
      emit({ type: 'record', id: rec.id });
      return { invoiceId: rec.id, invoiceNumber: rec.number, status: rec.status, total: rec.amount, currency: rec.currency, payerUrl: rec.payerUrl, emailedToBuyer: Boolean(a.customer.email) };
    },
  },
  create_checkout: {
    facts: (a) => ({ action: 'create_checkout', total: checkoutTotal(a), currency: a.currency, newCustomer: isNewCustomer(a.customer), itemCount: a.items.length }),
    summary: (a) => ({ text: `Checkout link for ${a.customer.name} ${formatMoney(checkoutTotal(a), a.currency)}`, amount: checkoutTotal(a), currency: a.currency }),
    async run(a, ctx) {
      const gw = paypal();
      const order = await gw.createOrder({ ...a, reference: a.reference ?? `sp-${ctx.requestId.slice(0, 8)}` }, ctx.requestId);
      const base = orderToRecord(order, gw.mode);
      const rec = records.upsert({ ...base, customerName: a.customer.name, customerEmail: a.customer.email, country: a.customer.country ?? base.country, items: a.items });
      emit({ type: 'record', id: rec.id });
      return { orderId: rec.id, status: rec.status, total: rec.amount, currency: rec.currency, payerUrl: payerLinkOf(order) };
    },
  },
  send_reminder: {
    facts(a) {
      const r = mustRecord(a.invoiceId, 'invoice');
      return { action: 'send_reminder', status: r.status, lifecycle: lifecycleOf(r), remindersToday: remindersToday(r), tone: a.tone };
    },
    summary(a) {
      const r = records.get(a.invoiceId);
      return { text: `${a.tone} reminder to ${r?.customerName ?? a.invoiceId} for ${r ? formatMoney(r.amount - r.paid, r.currency) : 'invoice'}`, amount: r ? r.amount - r.paid : undefined, currency: r?.currency, target: a.invoiceId };
    },
    async run(a) {
      const r = mustRecord(a.invoiceId, 'invoice');
      const t = REMINDER_TEMPLATES[a.tone](r);
      await paypal().remindInvoice(a.invoiceId, { subject: t.subject, note: a.note ?? t.note, send_to_recipient: true, send_to_invoicer: false });
      const nowIso = new Date().toISOString();
      records.upsert({ ...r, reminders: r.reminders + 1, lastReminderAt: nowIso, remindersOnDay: remindersToday(r) + 1, updatedAt: nowIso });
      emit({ type: 'record', id: r.id });
      return { invoiceId: r.id, tone: a.tone, subject: t.subject, note: a.note ?? t.note, totalReminders: r.reminders + 1 };
    },
  },
  capture_order: {
    facts: (a) => ({ action: 'capture_order', status: records.get(a.orderId)?.status }),
    summary(a) {
      const r = records.get(a.orderId);
      return { text: `Capture ${r ? formatMoney(r.amount, r.currency) : ''} from ${r?.customerName ?? a.orderId}`.trim(), amount: r?.amount, currency: r?.currency, target: a.orderId };
    },
    async run(a) {
      const gw = paypal();
      // Deterministic PayPal-Request-Id: a double click or retry can never capture twice.
      const order = await gw.captureOrder(a.orderId, `capture-${a.orderId}`);
      const rec = records.upsert(orderToRecord(order, gw.mode, records.get(a.orderId)));
      emit({ type: 'record', id: rec.id });
      return { orderId: rec.id, status: rec.status, captureId: rec.captureId, captured: rec.paid, currency: rec.currency };
    },
  },
  refund_payment: {
    facts(a) {
      const r = mustRecord(a.orderId, 'order');
      const refundable = Math.max(0, r.paid - r.refunded);
      return { action: 'refund_payment', amount: a.amount ?? refundable, refundable, currency: r.currency, hasCapture: Boolean(r.captureId) };
    },
    summary(a) {
      const r = records.get(a.orderId);
      const amt = a.amount ?? (r ? r.paid - r.refunded : 0);
      return { text: `Refund ${r ? formatMoney(amt, r.currency) : amt} to ${r?.customerName ?? a.orderId}: ${a.reason}`, amount: amt, currency: r?.currency, target: a.orderId };
    },
    async run(a, ctx) {
      const gw = paypal();
      const r = mustRecord(a.orderId, 'order');
      const amount = a.amount ?? r.paid - r.refunded;
      const refund = await gw.refundCapture(r.captureId!, { amount: { value: amount.toFixed(2), currency_code: r.currency }, note: a.reason }, ctx.requestId);
      const order = await gw.getOrder(a.orderId);
      const rec = records.upsert({ ...orderToRecord(order, gw.mode, r), refunded: r.refunded + Number(refund.amount?.value ?? amount) });
      emit({ type: 'record', id: rec.id });
      return { orderId: rec.id, refundId: refund.id, refundStatus: refund.status, refunded: refund.amount, orderStatus: rec.status };
    },
  },
  add_tracking: {
    facts(a) {
      const r = mustRecord(a.orderId, 'order');
      return { action: 'add_tracking', status: r.status === 'PARTIALLY_REFUNDED' ? 'COMPLETED' : r.status, hasCapture: Boolean(r.captureId) };
    },
    summary: (a) => ({ text: `Add ${a.carrier} tracking ${a.trackingNumber} to order ${a.orderId}`, target: a.orderId }),
    async run(a) {
      const r = mustRecord(a.orderId, 'order');
      const known = ['FEDEX', 'UPS', 'USPS', 'DHL', 'INDIA_POST', 'BLUEDART', 'DELHIVERY', 'ARAMEX'];
      const carrier = a.carrier.toUpperCase();
      await paypal().addTracking(a.orderId, {
        capture_id: r.captureId!,
        tracking_number: a.trackingNumber,
        ...(known.includes(carrier) ? { carrier } : { carrier: 'OTHER', carrier_name_other: a.carrier }),
        notify_payer: a.notifyPayer,
      });
      const rec = records.upsert({ ...r, trackingNumber: a.trackingNumber, updatedAt: new Date().toISOString() });
      emit({ type: 'record', id: rec.id });
      return { orderId: rec.id, trackingNumber: a.trackingNumber, carrier };
    },
  },
  cancel_invoice: {
    facts: (a) => ({ action: 'cancel_invoice', status: records.get(a.invoiceId)?.status }),
    summary: (a) => ({ text: `Cancel invoice ${records.get(a.invoiceId)?.number ?? a.invoiceId}`, target: a.invoiceId }),
    async run(a) {
      const gw = paypal();
      await gw.cancelInvoice(a.invoiceId, { note: a.note, send_to_recipient: true, send_to_invoicer: false });
      const rec = records.upsert(invoiceToRecord(await gw.getInvoice(a.invoiceId), gw.mode, records.get(a.invoiceId)));
      emit({ type: 'record', id: rec.id });
      return { invoiceId: rec.id, status: rec.status };
    },
  },
};

// ── Dispatch ──────────────────────────────────────────────────────────────────
export async function dispatch<A extends ActionName>(action: A, rawArgs: unknown, actor: Actor): Promise<DispatchResult> {
  const parsed = schemas[action].safeParse(rawArgs);
  if (!parsed.success) {
    const error = parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ');
    audit.log({ actor, action, outcome: 'invalid', detail: { error } });
    return { status: 'error', action, summary: `Invalid ${action} request`, error };
  }
  const args = parsed.data as ActionArgs<A>;
  const def = defs[action] as Def<A>;

  let facts: PolicyFacts;
  let s: ReturnType<Def<A>['summary']>;
  try {
    facts = def.facts(args);
    s = def.summary(args);
  } catch (e) {
    const error = (e as Error).message;
    audit.log({ actor, action, outcome: 'error', detail: { error } });
    return { status: 'error', action, summary: action, error };
  }

  const verdict = evaluatePolicy(facts, actor, config().policy);
  if (verdict.verdict === 'deny') {
    audit.log({ actor, action, target: s.target, outcome: 'denied', detail: { summary: s.text, reasons: verdict.reasons } });
    emit({ type: 'audit', action, outcome: 'denied' });
    return { status: 'denied', action, summary: s.text, reasons: verdict.reasons };
  }
  if (verdict.verdict === 'require_approval') {
    const apr = approvals.create({ action, args, summary: s.text, amount: s.amount, currency: s.currency, reasons: verdict.reasons, requestedBy: actor });
    audit.log({ actor, action, target: apr.id, outcome: 'pending_approval', detail: { summary: s.text, reasons: verdict.reasons } });
    emit({ type: 'approval', id: apr.id, status: 'pending' });
    return { status: 'pending_approval', action, approvalId: apr.id, summary: s.text, reasons: verdict.reasons };
  }
  return execute(action, args, actor, s.text, s.target, randomUUID());
}

async function execute<A extends ActionName>(action: A, args: ActionArgs<A>, actor: Actor | string, summary: string, target: string | undefined, requestId: string): Promise<DispatchResult> {
  try {
    const result = await (defs[action] as Def<A>).run(args, { requestId });
    audit.log({ actor, action, target: target ?? String(result.invoiceId ?? result.orderId ?? ''), outcome: 'done', detail: { summary, result } });
    emit({ type: 'audit', action, outcome: 'done' });
    return { status: 'done', action, result, summary };
  } catch (e) {
    const debugId = e instanceof PayPalApiError ? e.debugId : undefined;
    const error = (e as Error).message;
    audit.log({ actor, action, target, outcome: 'error', detail: { summary, error, debugId } });
    emit({ type: 'audit', action, outcome: 'error' });
    return { status: 'error', action, summary, error, debugId };
  }
}

/** Human decision on a queued action. Re-checks deny rules first: state may have moved on. */
export async function decide(approvalId: string, decision: 'approve' | 'reject', by = 'user'): Promise<{ approval: Approval; result?: DispatchResult }> {
  const apr = approvals.get(approvalId);
  if (!apr) throw new Error(`Approval ${approvalId} not found`);
  if (!approvals.decide(approvalId, decision === 'approve' ? 'approved' : 'rejected', by)) {
    return { approval: approvals.get(approvalId)! }; // already decided: no double execution
  }
  audit.log({ actor: by, action: `approval.${decision}`, target: approvalId, outcome: 'done', detail: { summary: apr.summary } });
  if (decision === 'reject') {
    emit({ type: 'approval', id: approvalId, status: 'rejected' });
    return { approval: approvals.get(approvalId)! };
  }
  const action = apr.action as ActionName;
  const args = schemas[action].parse(apr.args) as ActionArgs<typeof action>;
  const recheck = evaluatePolicy((defs[action] as Def<typeof action>).facts(args), 'user', config().policy);
  const result: DispatchResult =
    recheck.verdict === 'deny'
      ? { status: 'denied', action, summary: apr.summary, reasons: recheck.reasons }
      : await execute(action, args, `${by} (approved ${approvalId})`, apr.summary, undefined, approvalId);
  approvals.finish(approvalId, result.status === 'done' ? { ok: true, result: result.result } : { ok: false, error: result.status === 'denied' ? result.reasons.join(' ') : result.status === 'error' ? result.error : 'not executed' });
  emit({ type: 'approval', id: approvalId, status: result.status === 'done' ? 'executed' : 'failed' });
  return { approval: approvals.get(approvalId)!, result };
}
