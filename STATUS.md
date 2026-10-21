# SellerPilot status

_Last updated 21 Oct 2026, 19:20 IST (UTC+5:30)_

## Works today (no accounts needed)

Everything below runs on `npm run dev` with zero configuration: mock PayPal plus the offline agent.

- **Agent inbox.** Paste a DM or order note and the agent parses buyer, items, prices, currency and email. It creates an invoice or checkout link, or it reminds, refunds, captures, tracks or summarizes. Screenshot input is wired for the LLM path (Gemini). The offline planner is text-only.
- **Approval gate.** Above-threshold, non-USD, first-contact, final-notice, large-refund and cancel actions wait in `/approvals`. Approving one re-checks the deny rules first, and approving twice is a no-op.
- **PayPal flows (mock).**
  - Invoice: create → send → remind (max 2/day) → paid via webhook.
  - Checkout: create → buyer approves → `CHECKOUT.ORDER.APPROVED` webhook → auto-capture → tracking → partial or full refund.
  - Cancel invoice.
  - Webhooks go through the real pipeline: header check, verify, dedupe by event id, re-fetch, upsert.
- **Collections agent.** Picks friendly, firm or final tone from days overdue. Final notices go to approval. Run it from the dashboard or `POST /api/cron/collections` (Bearer `CRON_SECRET`).
- **Dashboard (AG Grid Community v36).**
  - KPI cards, the "who still owes me" grid, and the orders/invoices/checkout/payments grid with quick filter, column filters, a pinned totals row and progress bars.
  - Live cell flashes over server-sent events, the approval queue, and the full activity log grid.
- **Audit.** Every tool call, approval, refusal and webhook is in `audit_log`, and every agent run is in `agent_runs`.

Verified on 21 Oct 2026. Logs are in `../logs/`.

| Check | Result |
|---|---|
| `npm test` | 11 files, **58 tests passed** (~0.9 s) |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | succeeds (Next 16.4.2, all routes compiled) |
| Manual end-to-end on dev server | DM → invoice queued (first contact) → approved → sent → mock buyer pays → `INVOICING.INVOICE.PAID` → PAID. "pay link $40 for Jake" → checkout → buyer approves → auto-captured. Collections: friendly, firm and final reminders (final queued). |

## Coded but not yet run against real services

| Piece | Where | Needs |
|---|---|---|
| PayPal REST gateway (OAuth token cache, retries, `PayPal-Request-Id`, Invoicing v2, Orders v2, Payments v2 refund, webhook verify) | `lib/paypal/client.ts`, `rest.ts`, `builders.ts` | Sandbox Client ID/Secret. Unit-tested against request/response shapes from the official OpenAPI specs (`../refs/`), with a fake `fetch` |
| Webhook signature verification (`/v1/notifications/verify-webhook-signature`) | `lib/paypal/rest.ts`, `app/api/paypal/webhook` | `PAYPAL_WEBHOOK_ID` plus a public HTTPS URL (deploy, or a tunnel) |
| LLM agent (Gemini or Groq via Vercel AI SDK v7, multi-step tool calls, image input) | `lib/agent/provider.ts`, `runner.ts` | `GEMINI_API_KEY` or `GROQ_API_KEY`. Tested with the AI SDK mock model, and it falls back to offline on error |
| AG Studio analytics dashboard | seam: `components/grid/RecordsGrid.tsx`, `/api/records` | AG Studio trial licence (start ~Nov 1) |

## Unverified assumptions (check on first sandbox run)

1. Sending an invoice with **no recipient email** uses `send_to_recipient: false` and relies on sharing the payer link. Whether the sandbox accepts this is untested.
2. **Status right after `/send`**: the docs show both `SENT` and `UNPAID`. The code treats both as awaiting payment.
3. **`PAYMENT.CAPTURE.REFUNDED` payload**: we follow the `up` link to find the capture. That link shape is inferred, not confirmed.
4. **Refunding an invoice payment** through Payments v2 using the invoice's `payment_id` is not attempted. Refunds are limited to checkout captures for now.
5. Mock-only error names (`REFUND_AMOUNT_EXCEEDED` etc.) may differ from the sandbox's real `issue` codes. The REST path surfaces PayPal's own `name`, `issue` and `debug_id` either way.
6. Default model ids (`gemini-2.5-flash`, `openai/gpt-oss-120b`) and Groq image support should be checked when the keys exist.
7. The tracking `carrier` value list in the agent schema is a short subset of the Orders v2 enum.
8. `@paypal/agent-toolkit` 1.11 peer-depends on `ai@^4`/`zod@^3`, which conflicts with AI SDK v7. We implemented equivalent typed tools ourselves. It's worth re-checking for a newer toolkit release.

## Next step that needs Sahil

**This is the point where live PayPal credentials become necessary.** Nothing further on the PayPal side can be verified until it's done.

1. Sign in at **developer.paypal.com** with a PayPal account.
2. Under *Testing Tools → Sandbox accounts*, create a **US Business** and a **US Personal** sandbox account. Don't use IN sandbox accounts: an unofficial report shows IN sandbox sellers get "only able to send payments", and INR can't be received.
3. Under *Apps & Credentials (Sandbox)*, **Create App** (Merchant) tied to the US business sandbox account, and enable **Invoicing** in its features.
4. Put the values in `.env.local`:
   ```
   PAYPAL_MODE=sandbox
   PAYPAL_CLIENT_ID=...
   PAYPAL_CLIENT_SECRET=...
   PAYPAL_INVOICER_EMAIL=<the US business sandbox email>
   ```
5. Also needed, independently: a Google AI Studio key (`LLM_PROVIDER=gemini`, `GEMINI_API_KEY`) and/or a Groq key.
6. Later, once deployed to a public URL: add a webhook on the app for the events in `lib/paypal/webhooks.ts` (`SUBSCRIBED_EVENTS`) and set `PAYPAL_WEBHOOK_ID`.

After step 4 I will run a scripted sandbox smoke test to settle the unverified items above. It will create an invoice, send it, pay it as the personal account through the payer link, create and capture an order, refund it, and verify a webhook.

## Not started

- Deploy (Render) and a public webhook URL
- AG Studio dashboard (milestone M4)
- Demo video, Devpost write-up
- Public GitHub repo (local git only so far; nothing pushed)
