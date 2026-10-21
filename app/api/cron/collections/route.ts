import { config } from '@/lib/config';
import { runCollections } from '@/lib/collections';
import { fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Scheduled tick (external pinger / Render cron). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function POST(req: Request) {
  const secret = config().app.cronSecret;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return json({ error: 'unauthorized' }, 401);
  try {
    await ready();
    const r = await runCollections();
    return json({ nudged: r.results.filter((x) => x.status === 'done').length, queued: r.results.filter((x) => x.status === 'pending_approval').length, plan: r.plan });
  } catch (e) {
    return fail(e);
  }
}
