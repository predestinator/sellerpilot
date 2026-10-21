import { config } from '@/lib/config';
import { paypal } from '@/lib/paypal';
import { parseEvent, readWebhookHeaders } from '@/lib/paypal/webhooks';
import { processWebhookEvent } from '@/lib/sync';
import { json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PayPal webhook listener.
 * 1. Read the RAW body (signature is computed over the exact bytes).
 * 2. Verify via POST /v1/notifications/verify-webhook-signature (needs PAYPAL_WEBHOOK_ID).
 * 3. Dedupe by event id, re-fetch the resource from PayPal, update cache, fan out over SSE.
 * Returns 200 quickly; PayPal retries non-2xx deliveries.
 */
export async function POST(req: Request) {
  await ready();
  const raw = await req.text();
  const headers = readWebhookHeaders(req.headers);
  if (!headers) return json({ error: 'missing PayPal transmission headers' }, 400);

  if (config().paypal.mode === 'sandbox' && !config().paypal.webhookId) {
    return json({ error: 'PAYPAL_WEBHOOK_ID not configured' }, 503);
  }
  let verified = false;
  try {
    verified = await paypal().verifyWebhookSignature(headers, raw);
  } catch (e) {
    console.error('[webhook] verification call failed', e);
    return json({ error: 'verification unavailable' }, 503); // PayPal will retry
  }
  if (!verified) return json({ error: 'signature verification failed' }, 401);

  let event;
  try {
    event = parseEvent(raw);
  } catch {
    return json({ error: 'malformed event' }, 400);
  }
  try {
    const outcome = await processWebhookEvent(event, paypal().mode === 'mock' ? 'mock' : 'paypal');
    return json({ ok: true, outcome });
  } catch (e) {
    console.error('[webhook] processing failed', e);
    return json({ error: 'processing failed' }, 500); // non-2xx → PayPal redelivers; claim() keeps it idempotent
  }
}
