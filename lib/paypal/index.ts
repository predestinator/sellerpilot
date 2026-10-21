/** Gateway factory: picks mock or sandbox from config, one instance per process. */
import { config } from '../config';
import { SqliteMockStore } from '../db/repo';
import { PayPalClient } from './client';
import type { PayPalGateway } from './gateway';
import { MockPayPalGateway } from './mock';
import { RestPayPalGateway } from './rest';

export * from './types';
export type { PayPalGateway } from './gateway';
export { PayPalApiError } from './client';

const g = globalThis as unknown as { __spGateway?: PayPalGateway };

export function buildGateway(): PayPalGateway {
  const c = config();
  const invoicer = { businessName: c.paypal.businessName, email: c.paypal.invoicerEmail };
  if (c.paypal.mode === 'sandbox') {
    const client = new PayPalClient({ clientId: c.paypal.clientId!, clientSecret: c.paypal.clientSecret!, baseUrl: c.paypal.apiBase });
    return new RestPayPalGateway({
      client,
      invoicer,
      webhookId: c.paypal.webhookId,
      returnUrls: (ref) => ({
        returnUrl: `${c.app.baseUrl}/api/paypal/return?ref=${encodeURIComponent(ref)}`,
        cancelUrl: `${c.app.baseUrl}/api/paypal/cancel?ref=${encodeURIComponent(ref)}`,
      }),
    });
  }
  return new MockPayPalGateway({ store: new SqliteMockStore(), invoicer, appBaseUrl: c.app.baseUrl });
}

export function paypal(): PayPalGateway {
  return (g.__spGateway ??= buildGateway());
}

export function setGateway(gw: PayPalGateway | undefined) {
  g.__spGateway = gw;
}
