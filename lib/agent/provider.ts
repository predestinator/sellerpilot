/**
 * Model provider abstraction. Switch with LLM_PROVIDER=gemini|groq|offline.
 *  - gemini: Google Generative AI via @ai-sdk/google (free AI Studio key; vision-capable)
 *  - groq:   any OpenAI-compatible Chat Completions endpoint via @ai-sdk/openai-compatible
 *            (Groq by default; point GROQ_BASE_URL elsewhere to swap vendors)
 *  - offline: no model; the deterministic planner in offline.ts handles requests
 * Adding a provider = one more case here; tools/policies/runner don't change.
 */
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { config, type AppConfig } from '../config';

export type ProviderName = AppConfig['llm']['provider'];
export type ResolvedModel = { provider: Exclude<ProviderName, 'offline'>; modelId: string; model: LanguageModel; vision: boolean };

export function resolveModel(c: AppConfig = config()): ResolvedModel | null {
  const { llm } = c;
  if (llm.provider === 'gemini' && llm.gemini.apiKey) {
    const google = createGoogleGenerativeAI({ apiKey: llm.gemini.apiKey });
    return { provider: 'gemini', modelId: llm.gemini.model, model: google(llm.gemini.model), vision: true };
  }
  if (llm.provider === 'groq' && llm.groq.apiKey) {
    const groq = createOpenAICompatible({ name: 'groq', baseURL: llm.groq.baseURL, apiKey: llm.groq.apiKey });
    // Vision depends on the chosen Groq model; the default text model is treated as text-only.
    return { provider: 'groq', modelId: llm.groq.model, model: groq(llm.groq.model), vision: /vision|llama-4|scout|maverick/i.test(llm.groq.model) };
  }
  return null;
}

export function describeProvider(c: AppConfig = config()) {
  const m = resolveModel(c);
  return m ? `${m.provider}:${m.modelId}` : 'offline (rule-based, no LLM key)';
}
