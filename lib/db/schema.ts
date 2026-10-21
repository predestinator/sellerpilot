// Generated from the SQL below; kept in TS so it bundles cleanly with Next.js.
export const SCHEMA_SQL = `
-- SellerPilot app state. PayPal stays the source of truth for invoices/orders;
-- "records" is a rebuildable cache for the grids.
CREATE TABLE IF NOT EXISTS records (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('invoice','order')),
  status      TEXT NOT NULL,
  customer    TEXT NOT NULL,
  amount      REAL NOT NULL,
  currency    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  json        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_kind_status ON records(kind, status);

CREATE TABLE IF NOT EXISTS approvals (
  id          TEXT PRIMARY KEY,
  action      TEXT NOT NULL,
  args        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  amount      REAL,
  currency    TEXT,
  reasons     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','executed','failed')),
  requested_by TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT,
  result      TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  outcome     TEXT NOT NULL,
  detail      TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  received_at  TEXT NOT NULL,
  processed_at TEXT,
  outcome      TEXT
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  provider    TEXT NOT NULL,
  input       TEXT NOT NULL,
  output      TEXT NOT NULL,
  steps       TEXT NOT NULL
);

-- Backing store for the offline PayPal simulator (mock mode only).
CREATE TABLE IF NOT EXISTS mock_paypal (
  kind TEXT NOT NULL,
  id   TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
`;
