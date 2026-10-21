import { decide } from '@/lib/actions';
import { body, fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ready();
    const { id } = await params;
    const { decision } = await body<{ decision?: string }>(req);
    if (decision !== 'approve' && decision !== 'reject') return json({ error: 'decision must be approve or reject' }, 400);
    return json(await decide(id, decision, 'user'));
  } catch (e) {
    return fail(e, 400);
  }
}
