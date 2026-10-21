import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '@/lib/agent/policies';

const P = { approvalThresholdUsd: 150, refundAutoLimitUsd: 50, approveFirstContact: true };
const inv = (o: Partial<{ total: number; currency: string; newCustomer: boolean; itemCount: number }> = {}) => ({ action: 'create_invoice' as const, total: 100, currency: 'USD', newCustomer: false, itemCount: 1, ...o });

describe('guardrail policy', () => {
  it('allows small invoices to known customers', () => {
    expect(evaluatePolicy(inv(), 'agent', P).verdict).toBe('allow');
  });
  it('requires approval above the threshold or for a new customer', () => {
    expect(evaluatePolicy(inv({ total: 151 }), 'agent', P)).toMatchObject({ verdict: 'require_approval' });
    expect(evaluatePolicy(inv({ newCustomer: true }), 'agent', P).reasons).toContain('First contact with a new customer.');
  });
  it('lets the human (user actor) proceed but keeps hard denials', () => {
    expect(evaluatePolicy(inv({ total: 500 }), 'user', P).verdict).toBe('allow');
    expect(evaluatePolicy(inv({ currency: 'INR' }), 'user', P).verdict).toBe('deny');
    expect(evaluatePolicy(inv({ total: 20_000 }), 'user', P).verdict).toBe('deny');
  });
  it('treats non-USD as needing approval (threshold is USD)', () => {
    expect(evaluatePolicy(inv({ currency: 'EUR', total: 10 }), 'agent', P).verdict).toBe('require_approval');
  });
  it('refunds: over-refund denied, above limit queued, small auto', () => {
    const r = (amount: number) => ({ action: 'refund_payment' as const, amount, refundable: 100, currency: 'USD', hasCapture: true });
    expect(evaluatePolicy(r(120), 'agent', P).verdict).toBe('deny');
    expect(evaluatePolicy(r(80), 'agent', P).verdict).toBe('require_approval');
    expect(evaluatePolicy(r(20), 'agent', P).verdict).toBe('allow');
    expect(evaluatePolicy({ ...r(20), hasCapture: false }, 'agent', P).verdict).toBe('deny');
  });
  it('reminders: only unpaid, max 2/day, final tone needs sign-off', () => {
    const m = (o = {}) => ({ action: 'send_reminder' as const, status: 'UNPAID', lifecycle: 'awaiting_payment', remindersToday: 0, tone: 'friendly' as const, ...o });
    expect(evaluatePolicy(m(), 'collections', P).verdict).toBe('allow');
    expect(evaluatePolicy(m({ lifecycle: 'paid', status: 'PAID' }), 'collections', P).verdict).toBe('deny');
    expect(evaluatePolicy(m({ remindersToday: 2 }), 'user', P).verdict).toBe('deny');
    expect(evaluatePolicy(m({ tone: 'final' }), 'collections', P).verdict).toBe('require_approval');
  });
  it('capture only after buyer approval; cancel always needs approval from the agent', () => {
    expect(evaluatePolicy({ action: 'capture_order', status: 'PAYER_ACTION_REQUIRED' }, 'system', P).verdict).toBe('deny');
    expect(evaluatePolicy({ action: 'capture_order', status: 'APPROVED' }, 'system', P).verdict).toBe('allow');
    expect(evaluatePolicy({ action: 'cancel_invoice', status: 'UNPAID' }, 'agent', P).verdict).toBe('require_approval');
  });
});
