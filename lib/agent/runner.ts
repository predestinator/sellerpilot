/**
 * Agent runner: one request in, a short answer + a full tool trace out.
 * LLM path: AI SDK generateText with tools and a bounded multi-step loop.
 * Offline path: deterministic planner (no key needed). Both write to agent_runs.
 */
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { agentRuns } from '../db/repo';
import { systemPrompt } from './prompts';
import { resolveModel, type ResolvedModel } from './provider';
import { runOffline } from './offline';
import { buildTools } from './tools';

export type AgentStep = { tool: string; input: unknown; output: unknown };
export type AgentRunResult = { runId: string; provider: string; text: string; steps: AgentStep[]; fallback?: string };
export type AgentInput = { message: string; image?: { data: string; mediaType: string } };

export const MAX_STEPS = 6;

export async function runAgent(input: AgentInput, opts: { model?: ResolvedModel | null } = {}): Promise<AgentRunResult> {
  const resolved = opts.model === undefined ? resolveModel() : opts.model;
  const message = input.message.slice(0, 8000);

  if (!resolved) {
    const r = await runOffline(message);
    const runId = agentRuns.save({ provider: 'offline', input: message, output: r.text, steps: r.steps });
    return { runId, provider: 'offline', ...r, ...(input.image ? { fallback: 'Screenshots need an LLM key (GEMINI_API_KEY); only the text was used.' } : {}) };
  }

  const content: Exclude<ModelMessage, { role: 'system' | 'assistant' | 'tool' }>['content'] =
    input.image && resolved.vision
      ? [
          { type: 'text', text: message || 'Create the right PayPal request for the order in this screenshot.' },
          { type: 'image', image: input.image.data, mediaType: input.image.mediaType },
        ]
      : message;

  try {
    const result = await generateText({
      model: resolved.model,
      system: systemPrompt(),
      messages: [{ role: 'user', content }],
      tools: buildTools('agent'),
      stopWhen: stepCountIs(MAX_STEPS),
      maxRetries: 2,
      temperature: 0,
    });
    const steps: AgentStep[] = result.steps.flatMap((s) =>
      s.toolResults.map((tr) => ({ tool: tr.toolName, input: tr.input, output: tr.output })),
    );
    const text = result.text || (steps.length ? 'Done. See the actions below.' : 'I did not take any action.');
    const label = `${resolved.provider}:${resolved.modelId}`;
    const runId = agentRuns.save({ provider: label, input: message, output: text, steps });
    return { runId, provider: label, text, steps };
  } catch (e) {
    // Free-tier quota or provider outage: degrade to the offline planner rather than fail the seller.
    const r = await runOffline(message);
    const fallback = `LLM unavailable (${(e as Error).message.slice(0, 160)}); handled by the offline planner.`;
    const runId = agentRuns.save({ provider: 'offline-fallback', input: message, output: r.text, steps: r.steps });
    return { runId, provider: 'offline-fallback', ...r, fallback };
  }
}
