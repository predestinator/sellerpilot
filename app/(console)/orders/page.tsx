'use client';
import { useMemo, useRef, useState } from 'react';
import type { GridApi } from 'ag-grid-community';
import { ApprovalsGrid } from '@/components/grid/ApprovalsGrid';
import { inBucket, RecordsGrid, type GridView, type StatusBucket } from '@/components/grid/RecordsGrid';
import { KpiStrip, type Summary } from '@/components/KpiStrip';
import { Topbar } from '@/components/Topbar';
import { useToast } from '@/components/Toasts';
import { useApprovalDecision } from '@/components/useApprovalDecision';
import { postJson, useLive } from '@/components/useLive';
import { useRowActions } from '@/components/useRowActions';
import type { CommerceRecord } from '@/lib/domain';
import type { Approval } from '@/lib/db/repo';

type Tab = GridView | 'approvals';
const TABS: [Tab, string][] = [
  ['all', 'Everything'],
  ['invoice', 'Invoices'],
  ['order', 'Checkout orders'],
  ['payments', 'Payments'],
  ['approvals', 'Needs approval'],
];
const BUCKETS: [StatusBucket, string][] = [
  ['any', 'All statuses'],
  ['open', 'Open'],
  ['overdue', 'Overdue'],
  ['paid', 'Paid'],
  ['refunded', 'Refunded'],
  ['cancelled', 'Cancelled'],
];

export default function Orders() {
  const { data, error } = useLive<{ records: CommerceRecord[]; summary: Summary }>('/api/records');
  const appr = useLive<{ approvals: Approval[] }>('/api/approvals');
  const [tab, setTab] = useState<Tab>('all');
  const [bucket, setBucket] = useState<StatusBucket>('any');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState<number | null>(null);
  const api = useRef<GridApi<CommerceRecord> | null>(null);
  const { onAction, dialog } = useRowActions();
  const { decide } = useApprovalDecision();
  const toast = useToast();

  const rows = useMemo(() => data?.records ?? [], [data]);
  const pending = useMemo(() => appr.data?.approvals.filter((a) => a.status === 'pending') ?? [], [appr.data]);
  const counts = useMemo(() => Object.fromEntries(BUCKETS.map(([b]) => [b, rows.filter((r) => inBucket(r, b)).length])) as Record<StatusBucket, number>, [rows]);

  const sync = async () => {
    try {
      const r = await postJson<{ invoices: number; ordersRefreshed: number; error?: string }>('/api/sync');
      toast(r.error ? `Sync failed: ${r.error}` : `Synced ${r.invoices} invoices, refreshed ${r.ordersRefreshed} orders from PayPal`, r.error ? 'bad' : 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const exportCsv = () =>
    api.current?.exportDataAsCsv({ fileName: `sellerpilot-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, columnKeys: api.current.getColumns()?.filter((c) => c.getColDef().headerName).map((c) => c.getColId()) });
  const reset = () => {
    setQ('');
    setBucket('any');
    api.current?.setFilterModel(null);
    api.current?.resetColumnState();
  };

  return (
    <>
      <Topbar title="Orders & invoices" />
      <div className="content">
        <KpiStrip s={data?.summary} approvals={appr.data?.approvals} compact />

        <div className="row-gap">
          <div className="tabs" role="tablist">
            {TABS.map(([v, label]) => (
              <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>
                {label}
                {v === 'approvals' && pending.length > 0 && <span className="count">{pending.length}</span>}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <input className="search" type="search" placeholder="Quick search: customer, item, country, ref…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Quick search" />
          {tab !== 'approvals' && <button className="btn" onClick={exportCsv} title="Export the rows currently shown (AG Grid CSV export)">⤓ CSV</button>}
          <button className="btn" onClick={sync} title="Re-read invoices and open orders from PayPal (source of truth)">↻ Sync with PayPal</button>
        </div>

        {error && <div className="card card-b" style={{ color: 'var(--bad)' }}>{error}</div>}

        {tab === 'approvals' ? (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="grid-meta">
              <strong>{pending.length} waiting for you</strong>
              <span>The agent and the collections loop park anything above your guardrails here. Nothing has touched PayPal yet; approving re-checks policy, then runs it.</span>
            </div>
            <ApprovalsGrid rows={pending} decide={decide} quickFilter={q} />
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="grid-meta">
              <div className="filters" role="group" aria-label="Status filter">
                {BUCKETS.map(([b, label]) => (
                  <button key={b} className={`fchip ${bucket === b ? 'on' : ''}`} onClick={() => setBucket(b)} aria-pressed={bucket === b}>
                    {label} <span className="n">{counts[b]}</span>
                  </button>
                ))}
              </div>
              <div className="grow" />
              <span>{shown ?? rows.length} shown · click headers to sort, ☰ for column filters</span>
              <button className="btn sm ghost" onClick={reset}>Reset view</button>
            </div>
            <RecordsGrid rows={rows} view={tab} bucket={bucket} quickFilter={q} onAction={onAction} onApi={(a) => (api.current = a)} onVisibleCount={setShown} />
          </div>
        )}
      </div>
      {dialog}
    </>
  );
}
