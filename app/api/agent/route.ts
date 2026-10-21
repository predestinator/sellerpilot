import { z } from 'zod';
import { runAgent } from '@/lib/agent/runner';
import { body, fail, json, ready } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Input = z.object({
  message: z.string().max(8000).default(''),
  image: z
    .object({ data: z.string().max(7_000_000), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp']) })
    .optional(),
});

export async function POST(req: Request) {
  try {
    await ready();
    const parsed = Input.safeParse(await body(req));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'invalid input' }, 400);
    if (!parsed.data.message.trim() && !parsed.data.image) return json({ error: 'Paste a message or attach a screenshot.' }, 400);
    return json(await runAgent(parsed.data));
  } catch (e) {
    return fail(e);
  }
}
