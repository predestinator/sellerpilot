# SellerPilot status

_Last updated 22 Oct 2026, 19:20 IST (UTC+5:30)_

**22 Oct (submission prep):** fixed a render loop in `RecordsGrid` (pinned totals recomputed on every `modelUpdated`) that silently blocked client-side navigation away from the overview; README rewritten for judges; screenshots in `docs/screenshots`; fresh-copy check (`npm ci && npm run build && npm test`, 61/61) passes; demo video recorded from mock mode.

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
  - 22 Oct: shared KPI strip (incl. $ held for approval), status filter chips with counts, Open balance + currency columns, CSV export, totals row follows filters, approval queue as an AG Grid with Approve & run / Reject (overview, dashboard tab, /approvals), demo seed parks 3 real policy-held requests, judge-facing hero on the overview. Mock demo server can run beside the sandbox one: `PAYPAL_MODE=mock SELLERPILOT_DB=./data/sellerpilot-demo.db NEXT_DIST_DIR=.next-demo next dev -p 3100`.
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
| AG Studio analytics dashboard | seam: `components/grid/RecordsGrid.tsx`, `/api/records` | AG Studio trial licence (start ~Nov 1) |

## Live agent run: real Gemini + real PayPal sandbox (21 Oct 2026, 21:15 IST)

**Model config.** `LLM_PROVIDER=gemini`, free AI Studio key (no billing). Default model is now `gemini-flash-lite-latest` (`lib/config.ts`). For this new key, `gemini-2.5-flash` returns 404 and `gemini-flash-latest` / 3.x flash return 429/503 on free tier. Flash-lite answers reliably (~10–16 s per agent run, with tool round-trip). Vision (image input) verified on it. The runner already uses AI SDK `maxRetries: 2` and falls back to the offline planner on provider error.

`npm run agent:demo` (`scripts/live-agent.ts`) sends natural-language requests through `runAgent` → tools → policy-gated `dispatch` → `RestPayPalGateway`. It uses its own DB `./data/sellerpilot-sandbox.db` and sets `APPROVE_FIRST_CONTACT=false` by default so the USD threshold is what gets tested (override via env). Secrets are redacted; the report goes to `../logs/live-agent-*.json`. Pass your own request: `npm run agent:demo -- "Invoice ..."`.

| Request | Tool call | Real result |
|---|---|---|
| "Invoice Acme Co (billing acme@example.com) $120 for a logo design project, net 15" | `create_invoice` {Acme Co, acme@example.com, USD, 1× Logo design project @120, dueInDays 15} | **Real sandbox invoice `INV2-72YU-E3CK-E8MZ-229F`** (#0005), status `SENT`, USD 120.00, due 2026-11-05 (`DUE_ON_DATE_SPECIFIED`), invoicer = sandbox business. Read back independently via GET. Payer view: https://www.sandbox.paypal.com/invoice/p/#INV2-72YU-E3CK-E8MZ-229F |
| "Invoice Globex Corp (billing ap@globex.example.com) $500 for a full brand identity package, net 30" | `create_invoice` | **Guardrail fired:** `pending_approval` (`apr_f4156300`), reason "Total 500.00 USD is above the 150 USD auto-send limit." Nothing was sent to PayPal. |

Observations:
- `/send` returns payer-view `#INV2-XXXX-...`; `metadata.recipient_view_url` on GET is `#XXXXXXXXXXXXXXXX` (no prefix/dashes). We store the `/send` one.
- Flash-lite inferred `country: "US"` for Globex even though the prompt says to infer country only when it's stated. Harmless for now; tighten the prompt or strip the field if it matters.
- On pending approval, the model's reply says "Invoice created ... pending approval". Wording could be crisper ("queued, not sent").
- With the app default `APPROVE_FIRST_CONTACT=true`, the $120 Acme request would also be queued (new customer). That is by design.

## Live sandbox smoke test (21 Oct 2026, 20:40 IST)

`npm run smoke` (`scripts/live-smoke.ts`) drives the real `RestPayPalGateway` against `api-m.sandbox.paypal.com` with the SellerPilot sandbox app (US business `sb-oof2753471588@business.example.com`, buyer `sb-qx72v53480150@personal.example.com`). **17/17 steps as expected.** Secret and access token are redacted from stdout and the JSON report (`../logs/live-smoke-*.json`). `npm test` after: 11 files, 58 passed.

| Step | Real result |
|---|---|
| OAuth token | 200, 29 scopes, `expires_in` ~32,000 s |
| Create draft invoice | **201 with a link body only** (`{rel:"self", href:".../v2/invoicing/invoices/INV2-XXXX-XXXX-XXXX-XXXX", method:"GET"}`), no `id` in the body. Our href fallback + read-back works. Id shape `INV2-HEG8-4982-279Q-VQRS`; `invoice_number` auto-assigned `"0001"`, `"0002"`... Status `DRAFT` |
| Send (recipient has email) | **200**, body `{rel:"payer-view", href:"https://www.sandbox.paypal.com/invoice/p/#INV2-...", method:"GET"}`. GET afterwards: status **`SENT`** |
| Send (no recipient email, `send_to_recipient:false`) | **Accepted**, 200 with the same payer-view link. GET afterwards: status **`UNPAID`** |
| Remind | 204 |
| Cancel | 204, status then `CANCELLED` |
| Search invoices by `recipient_email` | works (`total_items`, `items[].status`) |
| Create order (intent CAPTURE, USD 5.00) | **200** (not 201), status **`PAYER_ACTION_REQUIRED`** (not `CREATED`), because we send `payment_source.paypal.experience_context`. Links: `self` + **`payer-action`** → `https://www.sandbox.paypal.com/checkoutnow?token=<orderId>`. Order id shape `8UY87107NP353060H` (17 chars). Mock already models this |
| Capture before approval | 422 `ORDER_NOT_APPROVED` (with `debug_id`), surfaced cleanly by `PayPalApiError` |
| Refund on unknown capture | 404 `INVALID_RESOURCE_ID` (`field: capture_id`, `location: path`) |
| List webhooks | 0 configured on the app |
| Verify webhook signature | Endpoint `/v1/notifications/verify-webhook-signature` confirmed. Required body: `auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event`. **`webhook_id` is required and must match `^[a-zA-Z0-9]+$`** (400 otherwise). With a bogus id it returns 200 `{verification_status:"FAILURE"}` |

### Assumptions now settled
1. No-email invoices: sandbox accepts `send_to_recipient:false`; status goes `DRAFT → UNPAID` and the payer link works for sharing. ✅
2. Status after `/send`: **`SENT`** when emailed to a recipient, **`UNPAID`** when not. Both already treated as awaiting payment. ✅
5. Real error names: `ORDER_NOT_APPROVED` (422), `INVALID_RESOURCE_ID` (404) confirmed. `REFUND_AMOUNT_EXCEEDED` etc. still to see on a real capture.
6. Defaults: Gemini **`gemini-flash-lite-latest`** (see Live agent section), Groq `openai/gpt-oss-120b` (`lib/config.ts`). Per Groq docs, `gpt-oss-120b` is **text-only**; Groq vision models are `qwen/qwen3.8-27b` (max 3 images) and `meta-llama/llama-4-scout-17b-16e-instruct` (being deprecated). **Note:** the vision regex in `lib/agent/provider.ts` does not match `qwen`, so set it if we switch Groq to Qwen for screenshots.

### Still unverified (needs a browser buyer approval or a public URL)
- **Order approve → capture → tracking → refund**: open the `payer-action` link, log in as the sandbox buyer, approve, then capture. Real refund response should carry `id, status (COMPLETED|PENDING|FAILED|CANCELLED), status_details, amount, note_to_payer, seller_payable_breakdown, payer, links` (Payments v2 schema). Request body: optional `amount`, `note_to_payer`, `invoice_id`, `custom_id`.
- **Invoice payment**: pay `INV2-72YU-E3CK-E8MZ-229F` via its payer-view link as the sandbox buyer (`sb-qx72v53480150@personal.example.com`); check `PAID` and the `payments.transactions[].payment_id` shape.
- 3. `PAYMENT.CAPTURE.REFUNDED` payload `up` link shape.
- 4. Refunding an invoice payment via Payments v2.
- **Webhook verification for real**: needs a sandbox webhook on the app (none exists), which needs a public HTTPS URL (Render deploy or a tunnel). Then set `PAYPAL_WEBHOOK_ID`.
- 7. Tracking carrier enum subset. 8. `@paypal/agent-toolkit` re-check.

## Next steps
1. Browser step: buyer approves the checkout order and pays one invoice in the sandbox, then re-run capture/refund/tracking.
2. ~~Run the LLM agent live~~ done (Gemini flash-lite). Next: approve `apr_f4156300` from `/approvals` to verify approved → executed on live sandbox.
3. Deploy, create the sandbox webhook for `SUBSCRIBED_EVENTS`, set `PAYPAL_WEBHOOK_ID`.

## Not started

- Deploy (Render) and a public webhook URL
- AG Studio dashboard (milestone M4)
- Public GitHub repo (local git only so far; nothing pushed). Demo video and Devpost text are drafted in `../submission/`.
