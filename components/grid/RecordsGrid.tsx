'use client';
import { useCallback, useMemo, useState } from 'react';
import { AllCommunityModule, type ColDef, type GridApi, type ModelUpdatedEvent, type ValueFormatterParams, type RowClassRules } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { daysOverdue, inBucket, lifecycleOf, openBalance, type CommerceRecord, type StatusBucket } from '@/lib/domain';
import { sellerPilotTheme } from './theme';
import { ActionsCell, CustomerCell, LIFECYCLE_LABEL, PaidCell, StatusCell, type GridContext } from './renderers';

const modules = [AllCommunityModule];

export type GridView = 'all' | 'invoice' | 'order' | 'payments' | 'overdue';
export { inBucket, openBalance, type StatusBucket } from '@/lib/domain';

const money = ({ value, data }: ValueFormatterParams<CommerceRecord>) =>
  typeof value === 'number' && data?.currency ? value.toLocaleString('en-US', { style: 'currency', currency: data.currency }) : '';
const date = ({ value }: ValueFormatterParams<CommerceRecord>) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

/**
 * AG Grid Community only (AllCommunityModule; no Enterprise licence needed).
 *
 * SEAM (AG Studio / newer AG offering): this component owns only column definitions,
 * renderers and the CommerceRecord feed from /api/records. To swap in AG Studio
 * dashboards later, point the Studio data source at the same rows and keep the
 * renderers/actions here; nothing in lib/ depends on the grid.
 */
export function RecordsGrid({ rows, view, quickFilter, onAction, height = 'tall', bucket = 'any', onApi, onVisibleCount }: {
  rows: CommerceRecord[];
  view: GridView;
  quickFilter?: string;
  onAction: GridContext['onAction'];
  height?: 'tall' | 'normal' | 'auto';
  bucket?: StatusBucket;
  /** Receives the grid API once ready (CSV export, column state, etc.). */
  onApi?: (api: GridApi<CommerceRecord>) => void;
  /** Rows left after the quick filter + column filters, for "showing N of M". */
  onVisibleCount?: (n: number) => void;
}) {
  const data = useMemo(() => {
    let out = rows;
    if (view === 'invoice' || view === 'order') out = rows.filter((r) => r.kind === view);
    if (view === 'payments') out = rows.filter((r) => r.paid > 0);
    if (view === 'overdue') out = rows.filter((r) => lifecycleOf(r) === 'awaiting_payment' && daysOverdue(r) > 0).sort((a, b) => daysOverdue(b) - daysOverdue(a));
    return bucket === 'any' ? out : out.filter((r) => inBucket(r, bucket));
  }, [rows, view, bucket]);

  const columnDefs = useMemo<ColDef<CommerceRecord>[]>(() => {
    const ref: ColDef<CommerceRecord> = {
      headerName: view === 'order' ? 'Order' : 'Ref',
      valueGetter: (p) => (p.node?.rowPinned ? '' : (p.data?.number ?? p.data?.id)),
      width: 130,
      pinned: 'left',
      cellClass: 'mono',
      tooltipValueGetter: (p) => p.data?.id,
    };
    const customer: ColDef<CommerceRecord> = { headerName: 'Customer', field: 'customerName', cellRenderer: CustomerCell, flex: 1.4, minWidth: 210, getQuickFilterText: (p) => `${p.data?.customerName} ${p.data?.customerEmail ?? ''} ${p.data?.country ?? ''}` };
    const kind: ColDef<CommerceRecord> = { headerName: 'Type', field: 'kind', width: 110, valueFormatter: (p) => (p.node?.rowPinned ? '' : p.value === 'invoice' ? 'Invoice' : 'Checkout'), filter: 'agTextColumnFilter' };
    const items: ColDef<CommerceRecord> = { headerName: 'Items', valueGetter: (p) => p.data?.items.map((i) => `${i.quantity}× ${i.name}`).join(', '), flex: 1.6, minWidth: 120, tooltipValueGetter: (p) => p.value as string };
    const amount: ColDef<CommerceRecord> = { headerName: 'Amount', field: 'amount', valueFormatter: money, type: 'rightAligned', width: 120, filter: 'agNumberColumnFilter', enableCellChangeFlash: true };
    const status: ColDef<CommerceRecord> = {
      headerName: 'Status',
      field: 'status',
      cellRenderer: StatusCell,
      width: 170,
      enableCellChangeFlash: true,
      filterValueGetter: (p) => (p.data ? LIFECYCLE_LABEL[lifecycleOf(p.data)] : ''),
      comparator: (_a, _b, na, nb) => (na.data && nb.data ? lifecycleOf(na.data).localeCompare(lifecycleOf(nb.data)) : 0),
    };
    const balance: ColDef<CommerceRecord> = {
      headerName: 'Open balance',
      valueGetter: (p) => (!p.data ? null : p.node?.rowPinned ? (p.data as CommerceRecord & { openTotal?: number }).openTotal ?? null : openBalance(p.data)),
      valueFormatter: (p) => (p.value ? money(p) : '—'),
      type: 'rightAligned',
      width: 130,
      filter: 'agNumberColumnFilter',
      cellClass: (p) => (p.value > 0 ? 'cell-owed' : 'cell-muted'),
    };
    const currencyCol: ColDef<CommerceRecord> = { headerName: 'Cur.', field: 'currency', width: 80, cellClass: 'mono' };
    const paid: ColDef<CommerceRecord> = { headerName: 'Collected', cellRenderer: PaidCell, width: 140, sortable: false, filter: false };
    const due: ColDef<CommerceRecord> = { headerName: 'Due', field: 'dueDate', valueFormatter: date, width: 100 };
    const overdue: ColDef<CommerceRecord> = { headerName: 'Days late', valueGetter: (p) => (!p.node?.rowPinned && p.data && lifecycleOf(p.data) === 'awaiting_payment' ? daysOverdue(p.data) : null), width: 110, type: 'rightAligned', filter: 'agNumberColumnFilter' };
    const reminders: ColDef<CommerceRecord> = { headerName: 'Nudges', field: 'reminders', width: 95, type: 'rightAligned', enableCellChangeFlash: true };
    const created: ColDef<CommerceRecord> = { headerName: 'Created', field: 'createdAt', valueFormatter: date, width: 105, sort: view === 'overdue' ? undefined : 'desc' };
    const actions: ColDef<CommerceRecord> = { headerName: '', cellRenderer: ActionsCell, width: 225, pinned: 'right', sortable: false, filter: false, resizable: false };

    if (view === 'payments') {
      return [
        ref,
        customer,
        kind,
        { headerName: 'Gross', field: 'paid', valueFormatter: money, type: 'rightAligned', width: 115 },
        { headerName: 'Refunded', field: 'refunded', valueFormatter: money, type: 'rightAligned', width: 115, cellStyle: (p) => (p.value > 0 ? { color: '#7a4fd6', fontWeight: 600 } : null) },
        { headerName: 'Net kept', valueGetter: (p) => (p.data ? p.data.paid - p.data.refunded : 0), valueFormatter: money, type: 'rightAligned', width: 115 },
        { headerName: 'Capture / payment', field: 'captureId', cellClass: 'mono', width: 190, valueFormatter: (p) => p.value ?? '— (invoice payment)' },
        { headerName: 'Tracking', field: 'trackingNumber', cellClass: 'mono', width: 150 },
        status,
        created,
        actions,
      ];
    }
    if (view === 'overdue') {
      // Compact set: this grid lives in a half-width panel on the overview.
      return [{ ...ref, width: 95 }, { ...customer, minWidth: 150 }, { ...overdue, headerName: 'Late', width: 75 }, { ...amount, width: 100 }, { ...reminders, width: 85 }, { ...actions, width: 165, cellRendererParams: { compact: true } }];
    }
    if (view === 'order') return [ref, customer, amount, status, paid, items, { headerName: 'Tracking', field: 'trackingNumber', cellClass: 'mono', width: 150 }, created, actions];
    if (view === 'invoice') return [ref, customer, amount, currencyCol, balance, status, paid, due, overdue, reminders, items, created, actions];
    return [ref, customer, kind, status, amount, currencyCol, balance, paid, due, items, created, actions];
  }, [view]);

  const rowClassRules = useMemo<RowClassRules<CommerceRecord>>(
    () => ({ 'row-overdue': (p) => Boolean(p.data && lifecycleOf(p.data) === 'awaiting_payment' && daysOverdue(p.data) > 0) }),
    [],
  );

  // Pinned totals follow what is on screen: recomputed after every filter/sort/quick-search.
  const [visible, setVisible] = useState<CommerceRecord[] | null>(null);
  const onModelUpdated = useCallback(
    (e: ModelUpdatedEvent<CommerceRecord>) => {
      const shown: CommerceRecord[] = [];
      e.api.forEachNodeAfterFilter((n) => n.data && shown.push(n.data));
      // Only update when the visible set really changed. Pinned-row updates also fire
      // modelUpdated, and an unconditional setState here loops and starves client navigation.
      setVisible((prev) => (prev && prev.length === shown.length && prev.every((r, i) => r === shown[i]) ? prev : shown));
      onVisibleCount?.(shown.length);
    },
    [onVisibleCount],
  );
  const totals = useMemo(() => {
    const usd = (visible ?? data).filter((r) => r.currency === 'USD');
    if (!usd.length) return [];
    const sum = (f: (r: CommerceRecord) => number) => usd.reduce((a, r) => a + f(r), 0);
    return [{ id: '__total', kind: 'invoice', customerName: `Total (USD, ${usd.length} rows)`, currency: 'USD', amount: sum((r) => r.amount), paid: sum((r) => r.paid), refunded: sum((r) => r.refunded), items: [], status: '', createdAt: '', reminders: sum((r) => r.reminders), openTotal: sum(openBalance), source: 'mock', updatedAt: '' } as unknown as CommerceRecord];
  }, [data, visible]);

  return (
    <div className={`grid-wrap ${height === 'normal' ? '' : height}`}>
      <AgGridProvider modules={modules}>
        <AgGridReact<CommerceRecord>
          theme={sellerPilotTheme}
          rowData={data}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true }}
          getRowId={(p) => p.data.id}
          context={{ onAction } satisfies GridContext}
          quickFilterText={quickFilter}
          rowClassRules={rowClassRules}
          pinnedBottomRowData={totals}
          onGridReady={(e) => onApi?.(e.api)}
          onModelUpdated={onModelUpdated}
          tooltipShowDelay={400}
          animateRows
          domLayout={height === 'auto' ? 'autoHeight' : 'normal'}
          pagination={data.length > 50}
          paginationPageSize={50}
          overlayNoRowsTemplate="<span style='color:#8a97ab'>Nothing here yet. Paste an order into the Agent inbox.</span>"
        />
      </AgGridProvider>
    </div>
  );
}
