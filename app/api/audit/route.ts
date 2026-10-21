import { audit } from '@/lib/db/repo';
import { fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ready();
    return json({ entries: audit.list(300) });
  } catch (e) {
    return fail(e);
  }
}
