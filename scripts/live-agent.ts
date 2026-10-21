/**
 * Live agent demo: real LLM (Gemini/Groq per .env) + real PayPal SANDBOX, through the
 * project's own runner (lib/agent/runner.ts → tools → policy-gated dispatch).
 *
 *   npm run agent:demo                         # two built-in scenarios ($120 auto, $500 gated)
 *   npm run agent:demo -- "Invoice Bob $40 ..." # your own request(s)
 *
 * Env (on top of .env):
 *   SELLERPILOT_DB           default ./data/sellerpilot-sandbox.db (keeps mock demo data separate)
 *   PAYPAL_INVOICER_EMAIL    default the SellerPilot sandbox business account
 *   APPROVE_FIRST_CONTACT    default false HERE so the USD threshold is what's being tested;
 *                            set true to see the first-contact rule gate every new buyer.
 * Secrets: client secret and LLM keys are redacted from all output and the JSON report.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

for (const f of ['.env', '.env.local']) if (existsSync(f)) process.loadEnvFile(f);
process.env.SELLERPILOT_DB ??= './data/sellerpilot-sandbox.db';
process.env.PAYPAL_INVOICER_EMAIL ??= 'sb-oof2753471588@business.example.com';
process.env.APPROVE_FIRST_CONTACT ??= 'false';

const SECRETS = [process.env.PAYPAL_CLIENT_SECRET, process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY].filter(
  (s): s is string => Boolean(s && s.length > 6),
);
const redact = (s: string) => {
  let out = s;
  for (const t of SECRETS) out = out.split(t).join('<redacted>');
  return out.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer <redacted>').replace(/AIza[0-9A-Za-z_\-]{20,}/g, '<redacted>');
};
const log = (...a: unknown[]) => console.log(redact(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2))).join(' ')));

const DEFAULT_REQUESTS = [
  'Invoice Acme Co (billing acme@example.com) $120 for a logo design project, net 15',
  'Invoice Globex Corp (billing ap@globex.example.com) $500 for a full brand identity package, net 30',
];

async function main() {
  const { config } = await import('../lib/config');
  const { runAgent } = await import('../lib/agent/runner');
  const { describeProvider } = await import('../lib/agent/provider');
  const { approvals } = await import('../lib/db/repo');

  const c = config();
  if (c.paypal.mode !== 'sandbox') throw new Error(`PAYPAL_MODE=sandbox with credentials required (resolved: ${c.paypal.mode})`);
  log(`PayPal: ${c.paypal.mode} (${c.paypal.apiBase}) | LLM: ${describeProvider(c)} | threshold ${c.policy.approvalThresholdUsd} USD | first-contact approval: ${c.policy.approveFirstContact} | db ${c.app.dbPath}`);

  const requests = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REQUESTS;
  const report: unknown[] = [];
  let failures = 0;
  for (const message of requests) {
    log(`\n▶ ${message}`);
    const t0 = Date.now();
    const r = await runAgent({ message });
    const ms = Date.now() - t0;
    log(`  provider: ${r.provider} (${ms} ms)${r.fallback ? `  FALLBACK: ${r.fallback}` : ''}`);
    for (const s of r.steps) {
      const o = s.output as Record<string, unknown>;
      log(`  tool ${s.tool} → ${o?.status ?? ''}${o?.invoiceId ? ` ${o.invoiceId}` : ''}${o?.approvalId ? ` approval ${o.approvalId}` : ''}`);
      log(`    input: ${JSON.stringify(s.input)}`);
      if (o?.payerUrl) log(`    payer view: ${o.payerUrl}`);
      if (o?.why) log(`    why: ${JSON.stringify(o.why)}`);
      if (o?.error) log(`    error: ${o.error}`);
    }
    log(`  agent says: ${r.text}`);
    if (!r.steps.length || r.provider.startsWith('offline')) failures++;
    report.push({ message, ms, ...r });
  }
  log(`\nPending approvals: ${approvals.list('pending').length}`);

  mkdirSync(resolve('../logs'), { recursive: true });
  const file = resolve('../logs', `live-agent-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, redact(JSON.stringify(report, null, 2)));
  log(`Report: ${file}`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redact(String((e as Error).stack ?? e)));
  process.exit(1);
});
