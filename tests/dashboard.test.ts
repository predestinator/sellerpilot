import { beforeEach, describe, expect, it } from 'vitest';
import { setGateway } from '@/lib/paypal';
import { resetConfig } from '@/lib/config';
import { resetDb } from '@/lib/db/index';
import { approvals, records } from '@/lib/db/repo';
import { seedDemoData } from '@/lib/seed';
import { inBucket, openBalance } from '@/lib/domain';
import { POST as decidePOST } from '@/app/api/approvals/[id]/route';
import { summarize } from '@/lib/agent/tools';

beforeEach(() => {
  resetConfig();
  resetDb();
  setGateway(undefined);
});

const decideReq = (id: string, decision: string) =>
  decidePOST(new Request(`http://x/api/approvals/${id}`, { method: 'POST', body: JSON.stringify({ decision }) }), { params: Promise.resolve({ id }) });

describe('dashboard data: approval queue + status buckets', () => {
  it('demo seed parks agent requests above the guardrails in the approval queue', async () => {
    const r = await seedDemoData();
    expect(r.heldForApproval).toBe(3);
    const pending = approvals.list('pending');
    expect(pending.map((a) => a.action).sort()).toEqual(['create_invoice', 'refund_payment', 'send_reminder']);
    expect(pending.every((a) => a.id.startsWith('apr_') && a.reasons.length > 0)).toBe(true);
    expect(summarize().pendingApprovals).toBe(3);
  });

  it('approving a held refund runs it through PayPal; rejecting leaves PayPal untouched', async () => {
    await seedDemoData();
    const refund = approvals.list('pending').find((a) => a.action === 'refund_payment')!;
    const orderId = (refund.args as { orderId: string }).orderId;
    const res = await (await decideReq(refund.id, 'approve')).json();
    expect(res.result).toMatchObject({ status: 'done', action: 'refund_payment' });
    expect(approvals.get(refund.id)!.status).toBe('executed');
    expect(records.get(orderId)!.refunded).toBeGreaterThan(0);

    const reminder = approvals.list('pending').find((a) => a.action === 'send_reminder')!;
    const invoiceId = (reminder.args as { invoiceId: string }).invoiceId;
    const before = records.get(invoiceId)!.reminders;
    await decideReq(reminder.id, 'reject');
    expect(approvals.get(reminder.id)!.status).toBe('rejected');
    expect(records.get(invoiceId)!.reminders).toBe(before);

    // double-click safe: deciding again does not re-run
    const again = await (await decideReq(refund.id, 'approve')).json();
    expect(again.result).toBeUndefined();
    expect((await decideReq(refund.id, 'maybe')).status).toBe(400);
  });

  it('status buckets and open balance match the grid filter chips', async () => {
    await seedDemoData();
    const all = records.list();
    const n = (b: Parameters<typeof inBucket>[1]) => all.filter((r) => inBucket(r, b)).length;
    expect(n('any')).toBe(all.length);
    expect(n('overdue')).toBeGreaterThanOrEqual(3);
    expect(n('paid')).toBeGreaterThan(0);
    expect(n('cancelled')).toBe(1);
    for (const r of all.filter((x) => inBucket(x, 'paid') || inBucket(x, 'cancelled'))) expect(openBalance(r)).toBe(0);
    const openUsd = all.filter((r) => r.currency === 'USD').reduce((t, r) => t + openBalance(r), 0);
    expect(Math.round(openUsd * 100) / 100).toBe(summarize().outstandingUsd);
  });
});
