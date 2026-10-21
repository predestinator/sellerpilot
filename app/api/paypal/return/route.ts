import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { dispatch } from '@/lib/actions';
import { records } from '@/lib/db/repo';
import { refreshRecord } from '@/lib/sync';
import { ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Buyer returns from PayPal approval. PayPal appends `token` (= order id) to return_url.
 * We re-read the order and capture it server-side (deterministic PayPal-Request-Id),
 * then show the buyer a thank-you page.
 */
export async function GET(req: Request) {
  await ready();
  const url = new URL(req.url);
  const orderId = url.searchParams.get('token');
  const base = config().app.baseUrl;
  if (!orderId || !records.get(orderId)) return NextResponse.redirect(`${base}/pay/done?state=unknown`);
  try {
    const rec = await refreshRecord('order', orderId);
    if (rec.status === 'APPROVED') await dispatch('capture_order', { orderId }, 'system');
    const after = records.get(orderId);
    return NextResponse.redirect(`${base}/pay/done?state=${after?.status === 'COMPLETED' ? 'paid' : 'pending'}&order=${encodeURIComponent(orderId)}`);
  } catch {
    return NextResponse.redirect(`${base}/pay/done?state=error&order=${encodeURIComponent(orderId)}`);
  }
}
