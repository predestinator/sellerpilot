'use client';
import { useMemo, useState } from 'react';
import { AllCommunityModule, type ColDef } from 'ag-grid-community';
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import type { Approval } from '@/lib/db/repo';
import { sellerPilotTheme } from './theme';

const modules = [AllCommunityModule];

type Ctx = { decide: (id: string, d: 'approve' | 'reject') => Promise<void> };

const ACTION_LABEL: Record<string, string> = {
  create_invoice: 'New invoice',
  create_checkout: 'New checkout link',
  send_reminder: 'Payment reminder',
  capture_order: 'Capture payment',
  refund_payment: 'Refund',
  add_tracking: 'Add tracking',
  cancel_invoice: 'Cancel invoice',
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function DecisionCell({ data, context }: CustomCellRendererProps<Approval, unknown, Ctx>) {
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  if (data.status !== 'pending') return <span className={`pill ${data.status}`} title={data.error}>{data.status}</span>;
  const go = (d: 'approve' | 'reject') => async () => {
    setBusy(true);
    try {
      await context.decide(data.id, d);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cell-actions">
      <button className="btn sm" disabled={busy} onClick={go('reject')}>Reject</button>
      <button className="btn sm primary" disabled={busy} onClick={go('approve')}>{busy ? 'Running…' : 'Approve & run'}</button>
    </div>
  );
}

function RequestCell({ data }: CustomCellRendererProps<Approval>) {
  if (!data) return null;
  return (
    <div className="cell-customer" title={data.summary}>
      <span>{data.summary}</span>
      <small>{data.reasons.join(' ')}</small>
    </div>
  );
}

/**
 * Human-in-the-loop queue as an AG Grid (Community). Anything the agent or the
 * collections loop wants to do above the guardrails lands here; nothing has
 * touched PayPal until a person clicks Approve.
 */
export function ApprovalsGrid({ rows, decide, mode = 'pending', quickFilter }: {
  rows: Approval[];
  quickFilter?: string;
  decide: Ctx['decide'];
  mode?: 'pending' | 'history';
}) {
  const columnDefs = useMemo<ColDef<Approval>[]>(() => {
    const cols: ColDef<Approval>[] = [
      { headerName: 'ID', field: 'id', width: 125, cellClass: 'mono', pinned: 'left' },
      { headerName: 'Action', field: 'action', width: 150, valueFormatter: (p) => ACTION_LABEL[p.value] ?? p.value },
      { headerName: 'Request · why it was held', field: 'summary', cellRenderer: RequestCell, flex: 2, minWidth: 320, getQuickFilterText: (p) => `${p.data?.summary} ${p.data?.reasons.join(' ')}`, tooltipValueGetter: (p) => p.data?.reasons.join(' ') },
      {
        headerName: 'Amount',
        field: 'amount',
        width: 115,
        type: 'rightAligned',
        filter: 'agNumberColumnFilter',
        valueFormatter: (p) => (typeof p.value === 'number' ? p.value.toLocaleString('en-US', { style: 'currency', currency: p.data?.currency ?? 'USD' }) : '—'),
      },
      { headerName: 'Asked by', field: 'requestedBy', width: 115 },
      mode === 'pending'
        ? { headerName: 'Waiting', field: 'createdAt', width: 125, valueFormatter: (p) => (p.value ? ago(p.value) : ''), sort: 'desc' }
        : { headerName: 'Decided', field: 'decidedAt', width: 190, sort: 'desc', valueFormatter: (p) => (p.value ? `${new Date(p.value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST` : '') },
    ];
    if (mode === 'history') cols.push({ headerName: 'By', field: 'decidedBy', width: 95 });
    cols.push({ headerName: mode === 'pending' ? 'Decision' : 'Outcome', cellRenderer: DecisionCell, width: mode === 'pending' ? 200 : 115, pinned: 'right', sortable: false, filter: false, resizable: false });
    return cols;
  }, [mode]);

  return (
    <div className="grid-wrap auto">
      <AgGridProvider modules={modules}>
        <AgGridReact<Approval>
          theme={sellerPilotTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          getRowId={(p) => p.data.id}
          context={{ decide } satisfies Ctx}
          rowHeight={56}
          domLayout="autoHeight"
          quickFilterText={quickFilter}
          tooltipShowDelay={400}
          animateRows
          overlayNoRowsTemplate={mode === 'pending' ? "<span style='color:#8a97ab'>All clear. Anything above your limits will wait here for you.</span>" : "<span style='color:#8a97ab'>No decisions yet.</span>"}
        />
      </AgGridProvider>
    </div>
  );
}
