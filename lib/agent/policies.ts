/**
 * Guardrails. Every money-moving or buyer-contacting action is evaluated here BEFORE it
 * runs. Three verdicts:
 *   allow            → execute now
 *   require_approval → park in the Approvals queue; a human must approve
 *   deny             → refuse with a reason the agent can relay
 * Humans acting from the UI ('user') are the approvers, so they skip require_approval
 * but are still bound by deny rules.
 */
import type { AppConfig } from '../config';

export type Actor = 'agent' | 'user' | 'collections' | 'system';
export type Verdict = 'allow' | 'require_approval' | 'deny';
export type PolicyResult = { verdict: Verdict; reasons: string[] };

export type PolicyFacts =
  | { action: 'create_invoice' | 'create_checkout'; total: number; currency: string; newCustomer: boolean; itemCount: number }
  | { action: 'send_reminder'; status?: string; lifecycle?: string; remindersToday: number; tone: 'friendly' | 'firm' | 'final' }
  | { action: 'capture_order'; status?: string }
  | { action: 'refund_payment'; amount: number; refundable: number; currency: string; hasCapture: boolean }
  | { action: 'add_tracking'; status?: string; hasCapture: boolean }
  | { action: 'cancel_invoice'; status?: string };

/** Hard ceiling for any single agent-created request (demo/sandbox safety net). */
export const HARD_CEILING = 10_000;

export function evaluatePolicy(f: PolicyFacts, actor: Actor, policy: AppConfig['policy']): PolicyResult {
  const deny: string[] = [];
  const approve: string[] = [];

  switch (f.action) {
    case 'create_invoice':
    case 'create_checkout': {
      if (f.itemCount === 0) deny.push('No line items.');
      if (!(f.total > 0)) deny.push('Total must be greater than zero.');
      if (f.total > HARD_CEILING) deny.push(`Total exceeds the ${HARD_CEILING.toLocaleString()} hard ceiling.`);
      // PayPal India accounts cannot receive INR (domestic payments stopped 1 Apr 2021); bill abroad in USD etc.
      if (f.currency === 'INR') deny.push('PayPal cannot receive INR for India-based sellers; bill in USD (or the buyer’s currency).');
      if (f.currency !== 'USD') approve.push(`Amount is in ${f.currency}; approval threshold is set in USD.`);
      else if (f.total > policy.approvalThresholdUsd) approve.push(`Total ${f.total.toFixed(2)} USD is above the ${policy.approvalThresholdUsd} USD auto-send limit.`);
      if (f.newCustomer && policy.approveFirstContact) approve.push('First contact with a new customer.');
      break;
    }
    case 'send_reminder':
      if (f.lifecycle !== 'awaiting_payment') deny.push(`Invoice is ${f.status ?? 'unknown'}; only unpaid invoices can be reminded.`);
      if (f.remindersToday >= 2) deny.push('PayPal allows at most 2 reminders per invoice per day.');
      if (f.tone === 'final') approve.push('Final-notice tone needs a human sign-off.');
      break;
    case 'capture_order':
      if (f.status !== 'APPROVED') deny.push(`Order is ${f.status ?? 'unknown'}; it can only be captured after the buyer approves it.`);
      break;
    case 'refund_payment':
      if (!f.hasCapture) deny.push('Nothing captured on this order yet, so there is nothing to refund.');
      if (!(f.amount > 0)) deny.push('Refund amount must be greater than zero.');
      if (f.amount > f.refundable + 1e-9) deny.push(`Refund ${f.amount.toFixed(2)} exceeds the refundable ${f.refundable.toFixed(2)} ${f.currency}.`);
      if (f.currency !== 'USD') approve.push(`Refund is in ${f.currency}; threshold is set in USD.`);
      else if (f.amount > policy.refundAutoLimitUsd) approve.push(`Refund ${f.amount.toFixed(2)} USD is above the ${policy.refundAutoLimitUsd} USD auto-refund limit.`);
      break;
    case 'add_tracking':
      if (!f.hasCapture || f.status !== 'COMPLETED') deny.push('Tracking can only be added to a captured (COMPLETED) order.');
      break;
    case 'cancel_invoice':
      if (!['UNPAID', 'SENT', 'SCHEDULED'].includes(f.status ?? '')) deny.push(`Invoice is ${f.status ?? 'unknown'}; only sent, unpaid invoices can be cancelled.`);
      approve.push('Cancelling an invoice is irreversible.');
      break;
  }

  if (deny.length) return { verdict: 'deny', reasons: deny };
  if (approve.length && actor !== 'user') return { verdict: 'require_approval', reasons: approve };
  return { verdict: 'allow', reasons: approve.length ? [`Approved directly by user (${approve.join(' ')})`] : [] };
}
