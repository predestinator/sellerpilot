'use client';
import { useMemo, useState } from 'react';
import { AllCommunityModule, type ColDef } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { sellerPilotTheme } from '@/components/grid/theme';
import { Topbar } from '@/components/Topbar';
import { useLive } from '@/components/useLive';
import type { AuditEntry } from '@/lib/db/repo';

const modules = [AllCommunityModule];

export default function Activity() {
  const { data } = useLive<{ entries: AuditEntry[] }>('/api/audit');
  const [q, setQ] = useState('');
  const cols = useMemo<ColDef<AuditEntry>[]>(
    () => [
      { headerName: 'When (IST)', field: 'at', width: 180, sort: 'desc', valueFormatter: (p) => new Date(p.value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }) },
      { headerName: 'Actor', field: 'actor', width: 170 },
      { headerName: 'Action', field: 'action', width: 200, cellClass: 'mono' },
      { headerName: 'Outcome', field: 'outcome', width: 150, cellRenderer: (p: { value: string }) => <span className={`pill ${p.value}`}>{p.value?.replace('_', ' ')}</span> },
      { headerName: 'Target', field: 'target', width: 220, cellClass: 'mono' },
      { headerName: 'Detail', flex: 1, minWidth: 300, valueGetter: (p) => { const d = p.data?.detail as { summary?: string; reasons?: string[]; error?: string } | undefined; return [d?.summary, d?.reasons?.join(' '), d?.error].filter(Boolean).join(' · ') || (d ? JSON.stringify(d) : ''); }, tooltipValueGetter: (p) => JSON.stringify(p.data?.detail, null, 2) },
    ],
    [],
  );
  return (
    <>
      <Topbar title="Activity log" />
      <div className="content">
        <div className="row-gap">
          <span className="muted">Every tool call, approval, webhook and refusal, in order. Nothing the agent does is invisible.</span>
          <div style={{ flex: 1 }} />
          <input className="search" type="search" placeholder="Filter log…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="grid-wrap tall">
            <AgGridProvider modules={modules}>
              <AgGridReact<AuditEntry> theme={sellerPilotTheme} rowData={data?.entries ?? []} columnDefs={cols} getRowId={(p) => String(p.data.seq)} quickFilterText={q} defaultColDef={{ sortable: true, filter: true, resizable: true }} tooltipShowDelay={300} />
            </AgGridProvider>
          </div>
        </div>
      </div>
    </>
  );
}
