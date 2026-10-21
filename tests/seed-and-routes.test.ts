import { beforeEach, describe, expect, it } from 'vitest';
import { setGateway } from '@/lib/paypal';
import { resetConfig } from '@/lib/config';
import { resetDb } from '@/lib/db/index';
import { records } from '@/lib/db/repo';
import { seedDemoData } from '@/lib/seed';
import { GET as recordsGET } from '@/app/api/records/route';
import { POST as actionsPOST } from '@/app/api/actions/route';
import { POST as cronPOST } from '@/app/api/cron/collections/route';
import { lifecycleOf, daysOverdue } from '@/lib/domain';

beforeEach(() => {
  resetConfig();
  resetDb();
  setGateway(undefined); // use the real factory → SQLite-backed mock store
});

describe('demo seed + API routes', () => {
  it('seeds a realistic mixed dataset including overdue invoices', async () => {
    const r = await seedDemoData();
    expect(r).toMatchObject({ seeded: true, invoices: 7, orders: 4 });
    const all = records.list();
    expect(all.filter((x) => x.kind === 'invoice' && lifecycleOf(x) === 'awaiting_payment' && daysOverdue(x) > 0).length).toBeGreaterThanOrEqual(3);
    expect(all.some((x) => x.status === 'APPROVED')).toBe(true);
    expect(all.some((x) => x.status === 'PARTIALLY_REFUNDED')).toBe(true);
    expect((await seedDemoData()).seeded).toBe(false);
  });

  it('GET /api/records returns rows + summary', async () => {
    await seedDemoData();
    const res = await recordsGET(new Request('http://x/api/records?kind=order'));
    const j = await res.json();
    expect(j.records).toHaveLength(4);
    expect(j.summary.collectedUsd).toBeGreaterThan(0);
  });

  it('POST /api/actions validates the action name and runs as the user', async () => {
    await seedDemoData();
    expect((await actionsPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'drop_tables' }) }))).status).toBe(400);
    const approved = records.list('order').find((o) => o.status === 'APPROVED')!;
    const res = await actionsPOST(new Request('http://x', { method: 'POST', body: JSON.stringify({ action: 'capture_order', args: { orderId: approved.id } }) }));
    expect(await res.json()).toMatchObject({ status: 'done' });
    expect(records.get(approved.id)!.status).toBe('COMPLETED');
  });

  it('cron endpoint requires the bearer secret', async () => {
    expect((await cronPOST(new Request('http://x', { method: 'POST' }))).status).toBe(401);
    const ok = await cronPOST(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer test-secret' } }));
    expect(ok.status).toBe(200);
  });
});
