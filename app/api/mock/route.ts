import { paypal } from '@/lib/paypal';
import { isMockGateway } from '@/lib/paypal/mock';
import { processWebhookEvent } from '@/lib/sync';
import { seedDemoData } from '@/lib/seed';
import { body, fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Mock-mode only: plays the buyer's part on PayPal's hosted pages, then feeds the
 * resulting event through the SAME webhook pipeline real PayPal deliveries use.
 */
export async function POST(req: Request) {
  const gw = paypal();
  if (!isMockGateway(gw)) return json({ error: 'Simulator is only available in mock mode' }, 404);
  try {
    await ready();
    const { op, id } = await body<{ op?: string; id?: string }>(req);
    if (op === 'reseed') return json(await seedDemoData(true));
    if (!id) return json({ error: 'id required' }, 400);
    const event = op === 'pay_invoice' ? await gw.simulateInvoicePaid(id) : op === 'approve_order' ? await gw.simulateBuyerApproval(id) : undefined;
    if (!event) return json({ error: `unknown op ${op}` }, 400);
    const outcome = await processWebhookEvent(event, 'mock');
    return json({ ok: true, event: event.event_type, outcome });
  } catch (e) {
    return fail(e, 422);
  }
}
