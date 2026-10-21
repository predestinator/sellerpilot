# SellerPilot

**An AI back office for small sellers who get paid from abroad.**
Paste a customer's DM, order note or screenshot. SellerPilot turns it into a PayPal invoice or checkout link and watches for payment. It also chases late payers, captures approved orders, adds tracking and handles refunds. Anything risky waits for your OK, and every step is logged.

> Status: hackathon build in progress (PayPal AI Hackathon, 2026). The app runs end to end against a built-in PayPal simulator. Sandbox wiring is coded and tested against recorded request shapes but **has not yet been run against the live sandbox**. See [STATUS.md](STATUS.md).

## Why

An Indian block-print studio sells to a buyer in Seattle over Instagram. The order arrives as a chat message. Then comes a manual loop: typing up an invoice, sending a pay link, checking whether it was paid, nudging politely, then less politely, adding tracking, and handling a refund for a loose tassel. SellerPilot runs that loop on PayPal's APIs, and the seller stays in charge of anything that moves real money.

## What it does

| You say / do | SellerPilot does (PayPal API) |
|---|---|
| Paste "Hi! I'm Grace from Seattle, 2× indigo cushion covers at $28 + $12 shipping, grace@…" | Parses items, prices, currency and buyer. Creates and sends an invoice (Invoicing v2 `POST /v2/invoicing/invoices` → `/send`) |
| "Send a pay link: 1 brass diya set $55…" | Creates a checkout order (Orders v2 `POST /v2/checkout/orders`) and returns the buyer's approval link |
| Buyer approves the checkout | Webhook `CHECKOUT.ORDER.APPROVED` is verified and the order is captured (`/capture`) |
| "Remind everyone who is overdue" / the collections agent tick | Sends friendly, firm or final reminders (`/remind`) by days overdue, at most 2 a day. Final notices need approval |
| "Refund Hannah $20, one tassel was loose" | Partial refund on the capture (Payments v2 `/v2/payments/captures/{id}/refund`), with approval above the limit |
| Add tracking | `POST /v2/checkout/orders/{id}/track` |
| "Who still owes me?" | Answers from the synced ledger |

**Guardrails** (`lib/agent/policies.ts`). Each action goes through a single `dispatch()` that applies policy, writes to the audit log, emits live events and sets idempotency keys:
- *Deny*: INR (PayPal India accounts can't receive INR; sellers bill abroad in USD etc. per PayPal's currency-codes page), a hard $10k ceiling, empty or zero orders, reminders on invoices that aren't awaiting payment, more than 2 reminders a day, capturing an unapproved order, refunding more than was captured, and tracking without a completed capture.
- *Needs approval*: amounts over `APPROVAL_THRESHOLD_USD`, non-USD currencies, first contact with a new customer, final-tone reminders, refunds over `REFUND_AUTO_LIMIT_USD`, and every cancellation.

**Dashboard.** Built on AG Grid Community: KPI cards, a "who still owes me" grid sorted worst first, an orders, invoices and payments grid with filters, quick search, progress bars, a pinned totals row and live cell flashes driven by server-sent events, an approval queue, and a full activity log grid. A later milestone adds an AG Studio analytics dashboard (the seam is `components/grid/RecordsGrid.tsx` plus `/api/records`).

## Quick start

```bash
cp .env.example .env.local   # optional: works with zero config
npm install
npm run dev                  # http://localhost:3000
npm test                     # unit + integration tests (mock PayPal, offline agent)
```

With no keys set, PayPal runs in **mock mode** and the agent uses an **offline rule-based planner**. The mock follows the documented PayPal state machines and links to local "buyer" pages (`/mock-paypal/...`). There, "Pay" emits the same webhook events PayPal would, and those events flow through the real webhook pipeline. This makes the full demo possible without any account.

To use real services, set these in `.env.local`:

| Variable | Needed for |
|---|---|
| `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Real calls to `api-m.sandbox.paypal.com` (live is refused by config) |
| `PAYPAL_INVOICER_EMAIL` | The sandbox business account email, shown as the invoicer |
| `PAYPAL_WEBHOOK_ID` | Webhook signature verification (needs a public URL) |
| `LLM_PROVIDER=gemini` + `GEMINI_API_KEY` or `LLM_PROVIDER=groq` + `GROQ_API_KEY` | The LLM agent, with image/screenshot input on Gemini |
| `CRON_SECRET` | `POST /api/cron/collections` (Bearer token) for the scheduled collections tick |

If the LLM errors, the agent falls back to the offline planner, so a demo never dies on stage.

## Architecture

```
app/(console)/*          seller console: overview, agent inbox, orders, approvals, activity
app/mock-paypal/*        simulated buyer pages (mock mode only)
app/api/*                route handlers (agent, actions, approvals, webhook, sync, SSE events, cron)
lib/paypal/              client (OAuth cache, retries, PayPal-Request-Id), REST gateway, mock gateway,
                         request builders, normalizers, webhook parsing + verification
lib/agent/               provider switch (Gemini / Groq / offline), tools, prompts, policies, runner
lib/actions.ts           the one dispatch() choke point + approval decisions
lib/sync.ts              PayPal-is-truth: webhook → dedupe → re-fetch → upsert
lib/collections.ts       reminder tone planning + runner
lib/db/                  SQLite (better-sqlite3): records, approvals, audit_log, webhook_events, agent_runs
components/grid/         AG Grid theme, renderers, RecordsGrid
tests/                   vitest suites
```

Design rules:
1. **PayPal is the source of truth.** The local DB is a cache plus an audit trail. A webhook is verified first and deduplicated by event id, then the resource is re-fetched rather than trusting the payload.
2. **One choke point.** The agent, the UI buttons and the collections job all call `dispatch()`. The model has no direct access to PayPal.
3. **Idempotent by default.** Every POST carries a `PayPal-Request-Id`, and the capture key is derived from the order id, so retries and double-clicks don't double-charge.
4. **The model proposes, policy decides.** Tool calls are validated with zod, and policy runs server-side whatever the model says.

## AI tools used

- Vercel AI SDK (`ai` v7) with `@ai-sdk/google` (Gemini) and `@ai-sdk/openai-compatible` (Groq) for multi-step tool calling.
- The agent's tools are typed zod tools in `lib/agent/tools.ts`. The official `@paypal/agent-toolkit` was evaluated but currently peer-depends on `ai@^4` / `zod@^3`, so the same operations are implemented directly against the REST APIs.
- Development was AI-assisted.

## License

[MIT](LICENSE)
