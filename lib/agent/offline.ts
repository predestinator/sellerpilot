/**
 * Offline planner: a deterministic, rule-based stand-in for the LLM so the product is
 * fully demoable with zero keys (and so tests are reproducible). It only understands
 * common phrasings; with GEMINI_API_KEY/GROQ_API_KEY set the real agent takes over.
 * It calls exactly the same policy-gated actions as the LLM agent.
 */
import { dispatch, type DispatchResult } from '../actions';
import { records } from '../db/repo';
import { daysOverdue, lifecycleOf, type CommerceRecord, type LineItem } from '../domain';
import { formatMoney } from '../money';
import { toneFor } from '../collections';
import { summarize } from './tools';
import type { AgentStep } from './runner';

const COUNTRIES: [RegExp, string][] = [
  [/\b(usa|u\.s\.a?|united states|new york|nyc|california|texas|seattle|chicago|boston)\b/i, 'US'],
  [/\b(uk|u\.k\.|united kingdom|england|london|manchester|scotland)\b/i, 'GB'],
  [/\b(germany|berlin|munich|hamburg)\b/i, 'DE'],
  [/\b(france|paris|lyon)\b/i, 'FR'],
  [/\b(italy|rome|milan)\b/i, 'IT'],
  [/\b(spain|madrid|barcelona)\b/i, 'ES'],
  [/\b(netherlands|amsterdam)\b/i, 'NL'],
  [/\b(canada|toronto|vancouver|montreal)\b/i, 'CA'],
  [/\b(australia|sydney|melbourne)\b/i, 'AU'],
  [/\b(uae|dubai|abu dhabi)\b/i, 'AE'],
  [/\b(singapore)\b/i, 'SG'],
];

const SYMBOL = '[$€£₹]|usd|eur|gbp|inr|rs\\.?';

export type ParsedOrder = {
  customer: { name: string; email?: string; country?: string; handle?: string };
  currency: string;
  items: LineItem[];
  shipping?: number;
  dueInDays?: number;
  wantsCheckout: boolean;
};

export function detectCurrency(text: string): string {
  if (/€|\beur\b|\beuros?\b/i.test(text)) return 'EUR';
  if (/£|\bgbp\b|\bpounds?\b/i.test(text)) return 'GBP';
  if (/₹|\binr\b|\brs\.?\s?\d|\brupees?\b/i.test(text)) return 'INR';
  return 'USD';
}

export function parseOrderMessage(text: string): ParsedOrder | { missing: string } {
  const email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  const handle = text.match(/(?:^|\s)@([a-z0-9._]{3,30})\b/i)?.[1];
  const name =
    text.match(/\b(?:[Nn]ame|[Cc]ustomer|[Bb]uyer|[Cc]lient)\s*[:\-]\s*([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u)?.[1] ??
    text.match(/\b(?:[Ii] am|[Ii][’']m|[Tt]his is|[Ii]t[’']s)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u)?.[1] ??
    text.match(/\b(?:from|for)\s+([A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?)/u)?.[1] ??
    (handle ? `@${handle}` : undefined) ??
    (email ? email.split('@')[0] : undefined);
  const country = COUNTRIES.find(([re]) => re.test(text))?.[1];
  const currency = detectCurrency(text);

  let shipping: number | undefined;
  const shipM = text.match(new RegExp(`shipping[^\\d\\n]{0,20}(?:${SYMBOL})?\\s?(\\d+(?:\\.\\d{1,2})?)`, 'i'));
  if (shipM) shipping = Number(shipM[1]);
  const body = shipM ? text.replace(shipM[0], ' ') : text;

  const items: LineItem[] = [];
  // "2x cushion cover @ $28", "3 silver earrings at €34 each", "1 logo design for $250"
  const withQty = new RegExp(
    `(\\d+)\\s*(?:x|×|pcs?|pieces|units)?\\s+([\\p{L}][\\p{L}\\d\\s'&/-]{1,60}?)\\s*(@|at|for|-|:|,)?\\s*(?:${SYMBOL})\\s?(\\d+(?:\\.\\d{1,2})?)\\s*(each|ea|apiece|per\\s?\\w+|\\/\\s?\\w+)?`,
    'giu',
  );
  for (const m of body.matchAll(withQty)) {
    const qty = Number(m[1]);
    const price = Number(m[4]);
    const perUnit = Boolean(m[5]) || m[3] === '@' || m[3]?.toLowerCase() === 'at';
    const unitPrice = perUnit || qty === 1 ? price : Math.round((price / qty) * 100) / 100;
    items.push({ name: tidy(m[2]!), quantity: qty, unitPrice });
  }
  if (!items.length) {
    // "custom portrait $180" / "table runner - €65"
    const noQty = new RegExp(`([\\p{L}][\\p{L}\\d\\s'&/-]{2,60}?)\\s*(?:-|:|for|at|,)?\\s*(?:${SYMBOL})\\s?(\\d+(?:\\.\\d{1,2})?)`, 'giu');
    for (const m of body.matchAll(noQty)) {
      const n = tidy(m[1]!);
      if (/^(total|price|cost|pay|it|that|is|of)$/i.test(n)) continue;
      items.push({ name: n, quantity: 1, unitPrice: Number(m[2]) });
    }
  }
  if (!items.length) return { missing: 'I could not find a price in that message. What should I charge, and for what?' };

  const due = text.match(/\bdue\s+in\s+(\d{1,2})\s+days?\b/i)?.[1] ?? text.match(/\bnet\s?(\d{1,2})\b/i)?.[1];
  const wantsCheckout = /\b(checkout|pay\s?link|payment\s?link|send (?:a|the|me a) link|link)\b/i.test(text) && !/\binvoice\b/i.test(text);
  return {
    customer: { name: name ?? 'Customer', email, country, handle },
    currency,
    items,
    shipping,
    dueInDays: due ? Number(due) : undefined,
    wantsCheckout,
  };
}

function tidy(s: string) {
  const t = s
    .replace(/\b(please|pls|i want|i'd like|can i get|order|of|the|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,:;-]+$/, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function findCustomerRecord(text: string, pred: (r: CommerceRecord) => boolean): CommerceRecord | undefined {
  const words = text.toLowerCase();
  return records.list().filter(pred).find((r) => r.customerName.toLowerCase().split(/\s+/).some((p) => p.length > 2 && words.includes(p)));
}

const say = (r: DispatchResult): string => {
  if (r.status === 'done') {
    const link = (r.result as { payerUrl?: string }).payerUrl;
    return `Done: ${r.summary}.${link ? ` Payment link: ${link}` : ''}`;
  }
  if (r.status === 'pending_approval') return `Waiting for your approval (${r.approvalId}): ${r.summary}. ${r.reasons.join(' ')}`;
  if (r.status === 'denied') return `Not sent: ${r.reasons.join(' ')}`;
  return `That failed: ${r.error}`;
};

export async function runOffline(message: string): Promise<{ text: string; steps: AgentStep[] }> {
  const steps: AgentStep[] = [];
  const call = async (tool: Parameters<typeof dispatch>[0], input: Record<string, unknown>) => {
    const out = await dispatch(tool, input, 'agent');
    steps.push({ tool, input, output: out });
    return out;
  };
  const t = message.trim();

  if (/\b(remind|nudge|chase|follow[\s-]?up)\b/i.test(t)) {
    const one = findCustomerRecord(t, (r) => r.kind === 'invoice' && lifecycleOf(r) === 'awaiting_payment');
    const targets = one ? [one] : records.list('invoice').filter((r) => lifecycleOf(r) === 'awaiting_payment' && daysOverdue(r) > 0);
    if (!targets.length) return { text: 'Nobody is overdue right now. Nice.', steps };
    const lines: string[] = [];
    for (const r of targets) lines.push(`${r.customerName}: ${say(await call('send_reminder', { invoiceId: r.id, tone: toneFor(daysOverdue(r)) }))}`);
    return { text: lines.join('\n'), steps };
  }
  if (/\brefund\b/i.test(t)) {
    const r = findCustomerRecord(t, (x) => x.kind === 'order' && Boolean(x.captureId));
    if (!r) return { text: 'Which order should I refund? I could not match a customer with a captured checkout.', steps };
    const amt = t.match(new RegExp(`(?:${SYMBOL})\\s?(\\d+(?:\\.\\d{1,2})?)`, 'i'))?.[1];
    const reason = t.match(/\b(?:because|reason[:\s]|as)\s+(.{3,120})$/i)?.[1] ?? 'Refund issued by seller';
    return { text: say(await call('refund_payment', { orderId: r.id, ...(amt ? { amount: Number(amt) } : {}), reason })), steps };
  }
  if (/\bcapture\b/i.test(t)) {
    const one = findCustomerRecord(t, (x) => x.kind === 'order' && x.status === 'APPROVED');
    const targets = one ? [one] : records.list('order').filter((x) => x.status === 'APPROVED');
    if (!targets.length) return { text: 'No approved checkouts are waiting to be captured.', steps };
    const lines: string[] = [];
    for (const r of targets) lines.push(say(await call('capture_order', { orderId: r.id })));
    return { text: lines.join('\n'), steps };
  }
  if (/\btrack(ing)?\b/i.test(t)) {
    const num = t.match(/\b([A-Z0-9]{8,30})\b/)?.[1];
    const r = findCustomerRecord(t, (x) => x.kind === 'order' && Boolean(x.captureId));
    if (!num || !r) return { text: 'Tell me the customer and the tracking number, e.g. "tracking for Jake: 1Z999AA10123456784 UPS".', steps };
    const carrier = t.match(/\b(fedex|ups|usps|dhl|india[\s_]?post|bluedart|delhivery|aramex)\b/i)?.[1]?.toUpperCase().replace(/\s/, '_') ?? 'OTHER';
    return { text: say(await call('add_tracking', { orderId: r.id, trackingNumber: num, carrier, notifyPayer: true })), steps };
  }
  if (/\b(who owes|owes me|unpaid|outstanding|overdue|summary|how much|status)\b/i.test(t) && !/[$€£₹]\s?\d/.test(t)) {
    const s = summarize();
    steps.push({ tool: 'business_summary', input: {}, output: s });
    const overdue = records.list('invoice').filter((r) => lifecycleOf(r) === 'awaiting_payment' && daysOverdue(r) > 0);
    const list = overdue.map((r) => `• ${r.customerName}: ${formatMoney(r.amount - r.paid, r.currency)}, ${daysOverdue(r)}d overdue`).join('\n');
    return {
      text: `Collected ${formatMoney(s.collectedUsd, 'USD')}, outstanding ${formatMoney(s.outstandingUsd, 'USD')} (${s.overdueCount} overdue, ${formatMoney(s.overdueUsd, 'USD')}). ${s.pendingApprovals} action(s) await your approval.${list ? `\n${list}` : ''}`,
      steps,
    };
  }

  const p = parseOrderMessage(t);
  if ('missing' in p) return { text: p.missing, steps };
  const out = p.wantsCheckout
    ? await call('create_checkout', { customer: p.customer, currency: p.currency, items: p.items, shipping: p.shipping })
    : await call('create_invoice', {
        customer: p.customer,
        currency: p.currency,
        items: p.shipping ? [...p.items, { name: 'Shipping', quantity: 1, unitPrice: p.shipping }] : p.items,
        dueInDays: p.dueInDays ?? 7,
        note: 'Thank you for your order! Pay securely with PayPal or card.',
      });
  return { text: say(out), steps };
}
