import { describe, expect, it } from 'vitest';
import { PayPalApiError, PayPalClient } from '@/lib/paypal/client';
import { fakeFetch, res, tokenRoute } from './helpers';

const mk = (routes: Parameters<typeof fakeFetch>[0], now = () => 0) => {
  const f = fakeFetch(routes);
  const sleeps: number[] = [];
  const client = new PayPalClient({ clientId: 'cid', clientSecret: 'sec', baseUrl: 'https://api-m.sandbox.paypal.com', fetch: f.fn, sleep: async (ms) => void sleeps.push(ms), now });
  return { client, calls: f.calls, sleeps };
};

describe('PayPalClient', () => {
  it('gets an OAuth token with Basic auth + client_credentials and caches it', async () => {
    const { client, calls } = mk({ ...tokenRoute, 'GET /v2/invoicing/invoices': [res(200, { items: [] })] });
    await client.request('/v2/invoicing/invoices');
    await client.request('/v2/invoicing/invoices');
    const tokenCalls = calls.filter((c) => c.url.endsWith('/v1/oauth2/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`);
    expect(tokenCalls[0]!.body).toBe('grant_type=client_credentials');
    expect(calls[1]!.headers.Authorization).toBe('Bearer A21AA-test');
  });

  it('refreshes the token once the cached one is about to expire', async () => {
    let t = 0;
    const { client, calls } = mk({ 'POST /v1/oauth2/token': [res(200, { access_token: 'a', expires_in: 120 })], 'GET /x': [res(200, {})] }, () => t);
    await client.request('/x');
    t = 61_000; // past expires_in - 60s
    await client.request('/x');
    expect(calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(2);
  });

  it('retries 429 honouring Retry-After and reuses the same PayPal-Request-Id', async () => {
    const { client, calls, sleeps } = mk({
      ...tokenRoute,
      'POST /v2/checkout/orders/ABC/capture': [res(429, { name: 'RATE_LIMIT_REACHED' }, { 'Retry-After': '2' }), res(503, 'busy'), res(201, { id: 'ABC', status: 'COMPLETED' })],
    });
    const out = await client.request<{ status: string }>('/v2/checkout/orders/ABC/capture', { method: 'POST', requestId: 'capture-ABC' });
    expect(out.data.status).toBe('COMPLETED');
    const posts = calls.filter((c) => c.url.includes('/capture'));
    expect(posts).toHaveLength(3);
    expect(new Set(posts.map((p) => p.headers['PayPal-Request-Id']))).toEqual(new Set(['capture-ABC']));
    expect(sleeps[0]).toBe(2000);
  });

  it('auto-generates a PayPal-Request-Id for every POST', async () => {
    const { client, calls } = mk({ ...tokenRoute, 'POST /y': [res(201, {})] });
    await client.request('/y', { method: 'POST', body: { a: 1 } });
    expect(calls[1]!.headers['PayPal-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('re-mints the token once on 401', async () => {
    const { client, calls } = mk({ ...tokenRoute, 'GET /z': [res(401, { error: 'invalid_token' }), res(200, { ok: true })] });
    await client.request('/z');
    expect(calls.filter((c) => c.url.endsWith('/oauth2/token'))).toHaveLength(2);
  });

  it('surfaces debug_id and issue on errors without retrying 4xx', async () => {
    const { client, calls } = mk({ ...tokenRoute, 'POST /v2/checkout/orders/X/capture': [res(422, { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed', debug_id: 'dbg123', details: [{ issue: 'ORDER_NOT_APPROVED' }] })] });
    const e = await client.request('/v2/checkout/orders/X/capture', { method: 'POST' }).catch((x) => x);
    expect(e).toBeInstanceOf(PayPalApiError);
    expect(e.debugId).toBe('dbg123');
    expect(e.issue).toBe('ORDER_NOT_APPROVED');
    expect(calls.filter((c) => c.url.includes('/capture'))).toHaveLength(1);
  });
});
