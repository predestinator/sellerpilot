import { subscribe } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Server-Sent Events: grids refetch when records, approvals or the audit log change. */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ type: 'hello' });
      const unsub = subscribe(send);
      const ping = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 25_000);
      cleanup = () => {
        clearInterval(ping);
        unsub();
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}
