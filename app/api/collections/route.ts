import { planCollections, runCollections } from '@/lib/collections';
import { fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET = preview who would be nudged; POST = run the collections agent now. */
export async function GET() {
  try {
    await ready();
    return json({ plan: planCollections() });
  } catch (e) {
    return fail(e);
  }
}

export async function POST() {
  try {
    await ready();
    return json(await runCollections());
  } catch (e) {
    return fail(e);
  }
}
