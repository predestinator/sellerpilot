import { beforeEach, describe, expect, it } from 'vitest';
import { planCollections, runCollections, toneFor } from '@/lib/collections';
import { approvals, records } from '@/lib/db/repo';
import { dispatch } from '@/lib/actions';
import { freshWorld } from './helpers';

beforeEach(() => {
  freshWorld();
});

const mkInvoice = async (name: string, dueDate: string) => {
  const r = await dispatch('create_invoice', { customer: { name, email: `${name.split(' ')[0]!.toLowerCase()}@example.com` }, items: [{ name: 'Item', quantity: 1, unitPrice: 30 }], dueInDays: 1 }, 'user');
  if (r.status !== 'done') throw new Error('setup');
  records.patch(String(r.result.invoiceId), { dueDate });
  return String(r.result.invoiceId);
};

describe('collections agent', () => {
  it('escalates tone with days overdue', () => {
    expect([toneFor(1), toneFor(7), toneFor(14)]).toEqual(['friendly', 'firm', 'final']);
  });

  it('nudges overdue invoices; final notices wait for approval; not-yet-due are skipped', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    const a = await mkInvoice('Amy Fox', '2026-10-18'); // 2d
    const b = await mkInvoice('Ben Ray', '2026-10-05'); // 15d
    await mkInvoice('Cal Dee', '2026-10-30'); // not due
    const plan = planCollections(now);
    expect(plan.map((p) => [p.invoiceId, p.tone])).toEqual([[b, 'final'], [a, 'friendly']]);
    const { results } = await runCollections(now);
    expect(results.map((r) => r.status)).toEqual(['pending_approval', 'done']);
    expect(approvals.list('pending')).toHaveLength(1);
    expect(records.get(a)!.reminders).toBe(1);
  });
});
