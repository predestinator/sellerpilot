'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Fetch JSON and refetch whenever the server pushes an SSE event (debounced). */
export function useLive<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setData(j as T);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    // The stream greets every new connection with a "hello" event, which triggers the
    // first load; later events (record/approval/audit changes) trigger debounced refetches.
    const schedule = (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(), ms);
    };
    const es = new EventSource('/api/events');
    es.onmessage = () => schedule(150);
    es.onerror = () => schedule(1500); // stream hiccup: still show fresh data
    schedule(600); // safety net if the stream is blocked by a proxy
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  return { data, error, reload: load };
}

export async function postJson<T = unknown>(url: string, payload?: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok && !(j && typeof j === 'object' && 'status' in j)) throw new Error((j as { error?: string }).error ?? res.statusText);
  return j as T;
}
