import { beforeEach, describe, expect, it } from 'vitest';
import { parseOrderMessage, detectCurrency } from '@/lib/agent/offline';
import { runAgent } from '@/lib/agent/runner';
import { records } from '@/lib/db/repo';
import { freshWorld } from './helpers';

beforeEach(() => {
  freshWorld();
});

describe('offline planner parsing', () => {
  it('reads quantities, unit prices, shipping, email and country from a DM', () => {
    const p = parseOrderMessage("Hi! I'm Grace Lee from Seattle, can I get 2x indigo cushion covers @ $28 each + shipping $12? email grace.lee@example.com");
    if ('missing' in p) throw new Error(p.missing);
    expect(p.customer).toMatchObject({ name: 'Grace Lee', email: 'grace.lee@example.com', country: 'US' });
    expect(p.items).toEqual([{ name: 'Indigo cushion covers', quantity: 2, unitPrice: 28 }]);
    expect(p.shipping).toBe(12);
    expect(p.wantsCheckout).toBe(false);
  });
  it('treats "for $X" on a multi-quantity line as a total, and detects pay links', () => {
    const p = parseOrderMessage('pay link please: 3 sticker packs for $18, for Noah Kim');
    if ('missing' in p) throw new Error(p.missing);
    expect(p.items[0]).toMatchObject({ quantity: 3, unitPrice: 6 });
    expect(p.wantsCheckout).toBe(true);
  });
  it('detects currencies and asks when there is no price', () => {
    expect(detectCurrency('3 earrings at €34 each')).toBe('EUR');
    expect(detectCurrency('£20')).toBe('GBP');
    expect(detectCurrency('₹500')).toBe('INR');
    expect(parseOrderMessage('hi do you ship to Canada?')).toHaveProperty('missing');
  });
});

describe('runAgent (offline provider)', () => {
  it('turns a DM into a real (mock) PayPal invoice and returns the link', async () => {
    const out = await runAgent({ message: 'Invoice Ethan Clarke ethan@example.com for a custom portrait $90, due in 10 days' }, { model: null });
    expect(out.provider).toBe('offline');
    expect(out.steps[0]!.tool).toBe('create_invoice');
    // First contact → approval queue (guardrail) rather than sending blindly.
    expect((out.steps[0]!.output as { status: string }).status).toBe('pending_approval');
    expect(out.text).toMatch(/Waiting for your approval/);
  });

  it('answers "who owes me" from the cache', async () => {
    const out = await runAgent({ message: 'Who still owes me?' }, { model: null });
    expect(out.steps[0]!.tool).toBe('business_summary');
    expect(out.text).toMatch(/Collected/);
    expect(records.count()).toBe(0);
  });
});
