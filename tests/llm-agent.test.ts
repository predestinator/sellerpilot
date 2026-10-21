import { beforeEach, describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { runAgent } from '@/lib/agent/runner';
import { buildTools } from '@/lib/agent/tools';
import { approvals, records } from '@/lib/db/repo';
import { freshWorld } from './helpers';

beforeEach(() => {
  freshWorld();
});

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } };
const toolCall = (toolName: string, input: unknown) => ({
  content: [{ type: 'tool-call' as const, toolCallId: `call_${toolName}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
  usage,
  warnings: [],
});
const finalText = (text: string) => ({ content: [{ type: 'text' as const, text }], finishReason: { unified: 'stop' as const, raw: 'stop' }, usage, warnings: [] });

describe('AI SDK agent loop (mock model, real tools + policy + mock PayPal)', () => {
  it('executes the tool the model picks and feeds the result back', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall('create_checkout', { customer: { name: 'Tom Baker', country: 'GB' }, currency: 'USD', items: [{ name: 'Brass diya set', quantity: 1, unitPrice: 55 }], shipping: 15 }),
        finalText('Checkout link ready for Tom.'),
      ],
    });
    const out = await runAgent({ message: 'pay link for Tom: diya set $55 + $15 shipping' }, { model: { provider: 'gemini', modelId: 'mock', model, vision: true } });
    expect(out.provider).toBe('gemini:mock');
    expect(out.text).toBe('Checkout link ready for Tom.');
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]!.tool).toBe('create_checkout');
    // New customer → queued, and nothing was created at PayPal.
    expect((out.steps[0]!.output as { status: string }).status).toBe('pending_approval');
    expect(approvals.list('pending')).toHaveLength(1);
    expect(records.list('order')).toHaveLength(0);
    // The model saw the tool result on its second call.
    expect(JSON.stringify(model.doGenerateCalls[1]!.prompt)).toContain('pending_approval');
  });

  it('falls back to the offline planner when the provider errors (e.g. free-tier 429)', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('429 RESOURCE_EXHAUSTED'); } });
    const out = await runAgent({ message: 'who owes me?' }, { model: { provider: 'groq', modelId: 'x', model, vision: false } });
    expect(out.provider).toBe('offline-fallback');
    expect(out.fallback).toMatch(/429/);
  });

  it('exposes every action plus read tools, each with an input schema', () => {
    const tools = buildTools();
    expect(Object.keys(tools).sort()).toEqual(['add_tracking', 'business_summary', 'cancel_invoice', 'capture_order', 'create_checkout', 'create_invoice', 'list_records', 'refund_payment', 'send_reminder'].sort());
    for (const t of Object.values(tools)) expect(t.inputSchema).toBeDefined();
  });
});
