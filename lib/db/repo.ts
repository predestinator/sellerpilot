/** Typed repositories over the SQLite tables. */
import { randomUUID } from 'node:crypto';
import type { CommerceRecord, RecordKind } from '../domain';
import type { MockStore } from '../paypal/mock';
import { db } from './index';

const now = () => new Date().toISOString();
const parse = <T>(s: string | null | undefined): T | undefined => (s ? (JSON.parse(s) as T) : undefined);

// ── records (dashboard cache) ─────────────────────────────────────────────────
export const records = {
  upsert(r: CommerceRecord) {
    db()
      .prepare(
        `INSERT INTO records (id, kind, status, customer, amount, currency, created_at, updated_at, json)
         VALUES (@id, @kind, @status, @customerName, @amount, @currency, @createdAt, @updatedAt, @json)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, customer=excluded.customer, amount=excluded.amount,
           currency=excluded.currency, updated_at=excluded.updated_at, json=excluded.json`,
      )
      .run({ ...r, json: JSON.stringify(r) });
    return r;
  },
  get(id: string): CommerceRecord | undefined {
    const row = db().prepare('SELECT json FROM records WHERE id = ?').get(id) as { json: string } | undefined;
    return parse<CommerceRecord>(row?.json);
  },
  list(kind?: RecordKind): CommerceRecord[] {
    const rows = (
      kind
        ? db().prepare('SELECT json FROM records WHERE kind = ? ORDER BY created_at DESC').all(kind)
        : db().prepare('SELECT json FROM records ORDER BY created_at DESC').all()
    ) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as CommerceRecord);
  },
  count(): number {
    return (db().prepare('SELECT COUNT(*) n FROM records').get() as { n: number }).n;
  },
  patch(id: string, p: Partial<CommerceRecord>) {
    const cur = records.get(id);
    if (!cur) return undefined;
    return records.upsert({ ...cur, ...p, updatedAt: now() });
  },
  findByCustomerEmail(email: string) {
    return records.list().filter((r) => r.customerEmail?.toLowerCase() === email.toLowerCase());
  },
  findByCustomerName(name: string) {
    const n = name.trim().toLowerCase();
    return records.list().filter((r) => r.customerName.toLowerCase() === n);
  },
};

// ── approvals (human-in-the-loop queue) ───────────────────────────────────────
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
export type Approval = {
  id: string;
  action: string;
  args: unknown;
  summary: string;
  amount?: number;
  currency?: string;
  reasons: string[];
  status: ApprovalStatus;
  requestedBy: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  result?: unknown;
  error?: string;
};

type ApprovalRow = {
  id: string; action: string; args: string; summary: string; amount: number | null; currency: string | null;
  reasons: string; status: ApprovalStatus; requested_by: string; created_at: string; decided_at: string | null;
  decided_by: string | null; result: string | null; error: string | null;
};

const toApproval = (r: ApprovalRow): Approval => ({
  id: r.id,
  action: r.action,
  args: JSON.parse(r.args),
  summary: r.summary,
  amount: r.amount ?? undefined,
  currency: r.currency ?? undefined,
  reasons: JSON.parse(r.reasons),
  status: r.status,
  requestedBy: r.requested_by,
  createdAt: r.created_at,
  decidedAt: r.decided_at ?? undefined,
  decidedBy: r.decided_by ?? undefined,
  result: parse(r.result),
  error: r.error ?? undefined,
});

export const approvals = {
  create(a: Pick<Approval, 'action' | 'args' | 'summary' | 'amount' | 'currency' | 'reasons' | 'requestedBy'>): Approval {
    const id = `apr_${randomUUID().slice(0, 8)}`;
    db()
      .prepare(
        `INSERT INTO approvals (id, action, args, summary, amount, currency, reasons, status, requested_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(id, a.action, JSON.stringify(a.args), a.summary, a.amount ?? null, a.currency ?? null, JSON.stringify(a.reasons), a.requestedBy, now());
    return approvals.get(id)!;
  },
  get(id: string): Approval | undefined {
    const r = db().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
    return r ? toApproval(r) : undefined;
  },
  list(status?: ApprovalStatus): Approval[] {
    const rows = (
      status
        ? db().prepare('SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC').all(status)
        : db().prepare('SELECT * FROM approvals ORDER BY created_at DESC').all()
    ) as ApprovalRow[];
    return rows.map(toApproval);
  },
  /** Atomically move pending → approved|rejected. Returns false if already decided (double-click safe). */
  decide(id: string, decision: 'approved' | 'rejected', by: string): boolean {
    const res = db()
      .prepare(`UPDATE approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'`)
      .run(decision, now(), by, id);
    return res.changes === 1;
  },
  finish(id: string, outcome: { ok: true; result: unknown } | { ok: false; error: string }) {
    db()
      .prepare('UPDATE approvals SET status = ?, result = ?, error = ? WHERE id = ?')
      .run(outcome.ok ? 'executed' : 'failed', outcome.ok ? JSON.stringify(outcome.result ?? null) : null, outcome.ok ? null : outcome.error, id);
  },
};

// ── audit log ─────────────────────────────────────────────────────────────────
export type AuditEntry = { seq: number; at: string; actor: string; action: string; target?: string; outcome: string; detail?: unknown };

export const audit = {
  log(e: Omit<AuditEntry, 'seq' | 'at'>) {
    db()
      .prepare('INSERT INTO audit_log (at, actor, action, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(now(), e.actor, e.action, e.target ?? null, e.outcome, e.detail === undefined ? null : JSON.stringify(e.detail));
  },
  list(limit = 200): AuditEntry[] {
    const rows = db().prepare('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?').all(limit) as (Omit<AuditEntry, 'detail'> & { detail: string | null; target: string | null })[];
    return rows.map((r) => ({ ...r, target: r.target ?? undefined, detail: parse(r.detail) }));
  },
};

// ── webhook idempotency ───────────────────────────────────────────────────────
export const webhookEvents = {
  /** Returns true the first time an event id is seen, false for duplicates. */
  claim(id: string, eventType: string): boolean {
    const res = db().prepare('INSERT OR IGNORE INTO webhook_events (id, event_type, received_at) VALUES (?, ?, ?)').run(id, eventType, now());
    return res.changes === 1;
  },
  /** Forget a claim whose processing failed, so PayPal's redelivery is processed again. */
  release(id: string) {
    db().prepare('DELETE FROM webhook_events WHERE id = ?').run(id);
  },
  done(id: string, outcome: string) {
    db().prepare('UPDATE webhook_events SET processed_at = ?, outcome = ? WHERE id = ?').run(now(), outcome, id);
  },
};

// ── agent runs ────────────────────────────────────────────────────────────────
export const agentRuns = {
  save(r: { provider: string; input: string; output: string; steps: unknown }) {
    const id = `run_${randomUUID().slice(0, 8)}`;
    db().prepare('INSERT INTO agent_runs (id, at, provider, input, output, steps) VALUES (?, ?, ?, ?, ?, ?)').run(id, now(), r.provider, r.input, r.output, JSON.stringify(r.steps));
    return id;
  },
};

// ── mock PayPal backing store ─────────────────────────────────────────────────
export class SqliteMockStore implements MockStore {
  get<T>(kind: string, id: string) {
    const r = db().prepare('SELECT json FROM mock_paypal WHERE kind = ? AND id = ?').get(kind, id) as { json: string } | undefined;
    return parse<T>(r?.json);
  }
  put<T>(kind: string, id: string, value: T) {
    db().prepare('INSERT INTO mock_paypal (kind, id, json) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET json = excluded.json').run(kind, id, JSON.stringify(value));
  }
  list<T>(kind: string) {
    return (db().prepare('SELECT json FROM mock_paypal WHERE kind = ? ORDER BY rowid').all(kind) as { json: string }[]).map((r) => JSON.parse(r.json) as T);
  }
}

/** Wipe app state + mock PayPal (used by "Reset demo data" in mock mode only). */
export function resetAppData() {
  db().exec('DELETE FROM records; DELETE FROM approvals; DELETE FROM audit_log; DELETE FROM webhook_events; DELETE FROM agent_runs; DELETE FROM mock_paypal;');
}
