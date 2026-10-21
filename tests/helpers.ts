import { resetConfig } from '@/lib/config';
import { resetDb } from '@/lib/db/index';
import { setGateway } from '@/lib/paypal';
import { MemoryMockStore, MockPayPalGateway } from '@/lib/paypal/mock';

/** Fresh in-memory DB + fresh mock PayPal for every test. */
export function freshWorld(opts: { now?: () => Date } = {}) {
  resetConfig();
  resetDb();
  const gw = new MockPayPalGateway({ store: new MemoryMockStore(), invoicer: { businessName: 'Test Studio', email: 'seller@example.com' }, appBaseUrl: 'http://localhost:3000', now: opts.now });
  setGateway(gw);
  return gw;
}

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

/** Scripted fetch: each route returns queued responses; every request is recorded. */
export function fakeFetch(routes: Record<string, (Response | (() => Response))[]>) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({ url, method, headers: { ...(init?.headers as Record<string, string>) }, body: init?.body as string | undefined });
    const key = `${method} ${path}`;
    const q = routes[key];
    if (!q || !q.length) throw new Error(`Unexpected request ${key}`);
    const next = q.length > 1 ? q.shift()! : q[0]!;
    return typeof next === 'function' ? next() : next.clone();
  };
  return { fn, calls };
}

export const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const tokenRoute = { 'POST /v1/oauth2/token': [res(200, { access_token: 'A21AA-test', token_type: 'Bearer', expires_in: 32400 })] };
