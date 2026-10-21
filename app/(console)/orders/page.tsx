'use client';
import { useState } from 'react';
import { RecordsGrid, type GridView } from '@/components/grid/RecordsGrid';
import { Topbar } from '@/components/Topbar';
import { useToast } from '@/components/Toasts';
import { postJson, useLive } from '@/components/useLive';
import { useRowActions } from '@/components/useRowActions';
import type { CommerceRecord } from '@/lib/domain';

const TABS: [GridView, string][] = [
  ['all', 'Everything'],
  ['invoice', 'Invoices'],
  ['order', 'Checkout orders'],
  ['payments', 'Payments'],
];

export default function Orders() {
  const { data, error } = useLive<{ records: CommerceRecord[] }>('/api/records');
  const [view, setView] = useState<GridView>('all');
  const [q, setQ] = useState('');
  const { onAction, dialog } = useRowActions();
  const toast = useToast();
  const sync = async () => {
    try {
      const r = await postJson<{ invoices: number; ordersRefreshed: number; error?: string }>('/api/sync');
      toast(r.error ? `Sync failed: ${r.error}` : `Synced ${r.invoices} invoices, refreshed ${r.ordersRefreshed} orders from PayPal`, r.error ? 'bad' : 'ok');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  return (
    <>
      <Topbar title="Orders & invoices" />
      <div className="content">
        <div className="row-gap">
          <div className="tabs" role="tablist">
            {TABS.map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <input className="search" type="search" placeholder="Search customer, item, country…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          <button className="btn" onClick={sync} title="Re-read invoices and open orders from PayPal (source of truth)">↻ Sync with PayPal</button>
        </div>
        {error && <div className="card card-b" style={{ color: 'var(--bad)' }}>{error}</div>}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <RecordsGrid rows={data?.records ?? []} view={view} quickFilter={q} onAction={onAction} />
        </div>
      </div>
      {dialog}
    </>
  );
}
