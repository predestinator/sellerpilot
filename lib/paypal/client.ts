/**
 * Low-level PayPal REST client.
 * - OAuth 2.0 client-credentials token, cached until shortly before `expires_in`.
 * - Retries 429/5xx with exponential backoff (honours Retry-After), refreshes once on 401.
 * - Sends a `PayPal-Request-Id` on every POST and REUSES it across retries so a retried
 *   capture/refund can never double-charge (PayPal idempotency guidance).
 * - Surfaces PayPal's `debug_id` on errors (needed when talking to PayPal support).
 * `fetch` is injectable so the whole client is unit-testable without network.
 */
import { randomUUID } from 'node:crypto';

export class PayPalApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly debugId?: string;
  readonly issue?: string;
  readonly details?: unknown;

  constructor(status: number, path: string, body: string) {
    let parsed: { name?: string; message?: string; debug_id?: string; details?: { issue?: string; description?: string }[] } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* non-JSON body */
    }
    const issue = parsed.details?.[0]?.issue ?? parsed.name;
    super(`PayPal ${status} on ${path}${issue ? ` (${issue})` : ''}: ${parsed.message ?? body.slice(0, 240)}`);
    this.name = 'PayPalApiError';
    this.status = status;
    this.path = path;
    this.debugId = parsed.debug_id;
    this.issue = issue;
    this.details = parsed.details;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PayPalClientOptions = {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetch?: FetchLike;
  maxAttempts?: number;
  /** Override for tests so retries don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Pre-serialised JSON body (used by webhook verification to keep raw bytes intact). */
  rawBody?: string;
  query?: Record<string, string | number | boolean | undefined>;
  requestId?: string;
  prefer?: 'return=minimal' | 'return=representation';
  headers?: Record<string, string>;
};

export type PayPalResponse<T> = { status: number; data: T; headers: Headers };

export class PayPalClient {
  private token?: { value: string; expiresAt: number };
  private readonly fetchImpl: FetchLike;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly opts: PayPalClientOptions) {
    this.fetchImpl = opts.fetch ?? ((i, init) => fetch(i, init));
    this.maxAttempts = opts.maxAttempts ?? 4;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  get baseUrl() {
    return this.opts.baseUrl;
  }

  /** POST /v1/oauth2/token with HTTP Basic client_id:secret, grant_type=client_credentials. */
  async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.now() < this.token.expiresAt) return this.token.value;
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(`${this.opts.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });
    if (!res.ok) throw new PayPalApiError(res.status, '/v1/oauth2/token', await res.text());
    const json = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh 60s early so an in-flight request never carries an expired token.
    this.token = { value: json.access_token, expiresAt: this.now() + Math.max(0, json.expires_in - 60) * 1000 };
    return json.access_token;
  }

  async request<T>(path: string, o: RequestOptions = {}): Promise<PayPalResponse<T>> {
    const method = o.method ?? 'GET';
    const requestId = method === 'POST' ? (o.requestId ?? randomUUID()) : undefined;
    const qs = o.query
      ? '?' +
        Object.entries(o.query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    const url = `${this.opts.baseUrl}${path}${qs === '?' ? '' : qs}`;
    const body = o.rawBody ?? (o.body === undefined ? (method === 'POST' ? '{}' : undefined) : JSON.stringify(o.body));

    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
        ...(o.prefer ? { Prefer: o.prefer } : {}),
        ...o.headers,
      };
      const res = await this.fetchImpl(url, { method, headers, body, cache: 'no-store' });

      if (res.ok) {
        const text = res.status === 204 ? '' : await res.text();
        return { status: res.status, data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
      }
      if (res.status === 401 && attempt === 1) {
        this.token = undefined; // expired/revoked token: mint a new one once
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250;
        await this.sleep(wait);
        continue;
      }
      throw new PayPalApiError(res.status, path, await res.text());
    }
  }
}
