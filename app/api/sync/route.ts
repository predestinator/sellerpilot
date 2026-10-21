import { syncInvoices } from '@/lib/sync';
import { fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await ready();
    return json(await syncInvoices());
  } catch (e) {
    return fail(e);
  }
}
