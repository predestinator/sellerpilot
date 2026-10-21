import { config } from '@/lib/config';
import { describeProvider } from '@/lib/agent/provider';
import { json } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Non-secret runtime facts for the UI banner and README checks. */
export async function GET() {
  const c = config();
  return json({
    paypal: {
      mode: c.paypal.mode,
      requestedMode: c.paypal.requestedMode,
      hasCredentials: c.paypal.hasCredentials,
      apiBase: c.paypal.apiBase,
      webhookVerification: c.paypal.mode === 'sandbox' ? Boolean(c.paypal.webhookId) : 'mock',
    },
    llm: describeProvider(c),
    policy: c.policy,
  });
}
