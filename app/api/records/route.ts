import { records } from '@/lib/db/repo';
import { summarize } from '@/lib/agent/tools';
import { fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    await ready();
    const kind = new URL(req.url).searchParams.get('kind');
    const rows = records.list(kind === 'invoice' || kind === 'order' ? kind : undefined);
    return json({ records: rows, summary: summarize() });
  } catch (e) {
    return fail(e);
  }
}
