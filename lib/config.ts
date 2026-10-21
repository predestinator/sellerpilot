import { z } from 'zod';

/**
 * Central, validated configuration. Every module reads env through here so the
 * mock/sandbox switch and the guardrail thresholds have exactly one source of truth.
 */
const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().finite().nonnegative());

const EnvSchema = z.object({
  PAYPAL_MODE: z.enum(['mock', 'sandbox']).optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_API_BASE: z.string().url().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_INVOICER_EMAIL: z.string().optional(),
  SELLER_BUSINESS_NAME: z.string().optional(),

  LLM_PROVIDER: z.enum(['gemini', 'groq', 'offline']).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().optional(),
  GROQ_BASE_URL: z.string().url().optional(),

  APPROVAL_THRESHOLD_USD: num(150),
  REFUND_AUTO_LIMIT_USD: num(50),
  APPROVE_FIRST_CONTACT: bool,

  APP_BASE_URL: z.string().url().optional(),
  SELLERPILOT_DB: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  SEED_DEMO_DATA: bool,
});

export type AppConfig = ReturnType<typeof loadConfig>;

const nonEmpty = (v?: string) => (v && v.trim() !== '' ? v.trim() : undefined);

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const e = EnvSchema.parse(env);
  const clientId = nonEmpty(e.PAYPAL_CLIENT_ID);
  const clientSecret = nonEmpty(e.PAYPAL_CLIENT_SECRET);
  const hasPayPalCreds = Boolean(clientId && clientSecret);

  // Sandbox only when explicitly requested AND credentials exist; otherwise the mock gateway.
  const paypalMode: 'mock' | 'sandbox' = e.PAYPAL_MODE === 'sandbox' && hasPayPalCreds ? 'sandbox' : 'mock';

  const apiBase = e.PAYPAL_API_BASE ?? SANDBOX_BASE;
  if (!apiBase.includes('sandbox')) {
    // Contest build: refuse to point at live PayPal by accident.
    throw new Error(`PAYPAL_API_BASE must be a sandbox URL, got ${apiBase}`);
  }

  const geminiKey = nonEmpty(e.GEMINI_API_KEY);
  const groqKey = nonEmpty(e.GROQ_API_KEY);
  let llmProvider = e.LLM_PROVIDER ?? (geminiKey ? 'gemini' : groqKey ? 'groq' : 'offline');
  if (llmProvider === 'gemini' && !geminiKey) llmProvider = 'offline';
  if (llmProvider === 'groq' && !groqKey) llmProvider = 'offline';

  return {
    paypal: {
      mode: paypalMode,
      requestedMode: e.PAYPAL_MODE ?? 'mock',
      hasCredentials: hasPayPalCreds,
      clientId,
      clientSecret,
      apiBase,
      webhookId: nonEmpty(e.PAYPAL_WEBHOOK_ID),
      invoicerEmail: nonEmpty(e.PAYPAL_INVOICER_EMAIL),
      businessName: nonEmpty(e.SELLER_BUSINESS_NAME) ?? 'SellerPilot Demo Studio',
    },
    llm: {
      provider: llmProvider as 'gemini' | 'groq' | 'offline',
      gemini: { apiKey: geminiKey, model: nonEmpty(e.GEMINI_MODEL) ?? 'gemini-flash-lite-latest' },
      groq: {
        apiKey: groqKey,
        model: nonEmpty(e.GROQ_MODEL) ?? 'openai/gpt-oss-120b',
        baseURL: e.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
      },
    },
    policy: {
      approvalThresholdUsd: e.APPROVAL_THRESHOLD_USD,
      refundAutoLimitUsd: e.REFUND_AUTO_LIMIT_USD,
      approveFirstContact: e.APPROVE_FIRST_CONTACT ?? true,
    },
    app: {
      baseUrl: (e.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
      dbPath: nonEmpty(e.SELLERPILOT_DB) ?? './data/sellerpilot.db',
      cronSecret: nonEmpty(e.CRON_SECRET),
      seedDemoData: e.SEED_DEMO_DATA ?? true,
    },
  };
}

let cached: AppConfig | undefined;
export function config(): AppConfig {
  return (cached ??= loadConfig());
}
/** Test hook: drop the memoised config after mutating process.env. */
export function resetConfig() {
  cached = undefined;
}
