/** Small helpers shared by route handlers. */
import { NextResponse } from 'next/server';
import { ensureSeeded } from './seed';

export async function ready() {
  await ensureSeeded();
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export function fail(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : String(e);
  return json({ error: message }, status);
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}
