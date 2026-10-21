'use client';
import { useMemo } from 'react';
import { AllCommunityModule, type ColDef, type ValueFormatterParams, type RowClassRules } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { daysOverdue, lifecycleOf, type CommerceRecord } from '@/lib/domain';
import { sellerPilotTheme } from './theme';
import { ActionsCell, CustomerCell, LIFECYCLE_LABEL, PaidCell, StatusCell, type GridContext } from './renderers';

const modules = [AllCommunityModule];

export type GridView = 'all' | 'invoice' | 'order' | 'payments' | 'overdue';

const money = ({ value, data }: ValueFormatterParams<CommerceRecord>) =>
  typeof value === 'number' && data?.currency ? value.toLocaleString('en-US', { style: 'currency', currency: data.currency }) : '';
const date = ({ value }: ValueFormatterParams<CommerceRecord>) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '';

/**
 * Seam for AG Studio: this component owns only column definitions + renderers.
 * The Studio dashboard (lib/studio) will consume the same CommerceRecord rows.
 */
export function RecordsGrid({ rows, view, quickFilter, onAction, height = 'tall' }: {
  rows: CommerceRecord[];
  view: GridView;
  quickFilter?: string;
  onAction: GridContext['onAction'];
  height?: 'tall' | 'normal';
}) {
  const data = useMemo(() => {
    if (view === 'invoice' || view === 'order') return rows.filter((r) => r.kind === view);
    if (view === 'payments') return rows.filter((r) => r.paid > 0);
    if (view === 'overdue') return rows.filter((r) => lifecycleOf(r) === 'awaiting_payment' && daysOverdue(r) > 0).sort((a, b) => daysOverdue(b) - daysOverdue(a));
    return rows;
  }, [rows, view]);

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
    const items: ColDef<CommerceRecord> = { headerName: 'Items', valueGetter: (p) => p.data?.items.map((i) => `${i.quantity}× ${i.name}`).join(', '), flex: 1.6, minWidth: 180, tooltipValueGetter: (p) => p.value as string };
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
    const paid: ColDef<CommerceRecord> = { headerName: 'Collected', cellRenderer: PaidCell, width: 140, sortable: false, filter: false };
    const due: ColDef<CommerceRecord> = { headerName: 'Due', field: 'dueDate', valueFormatter: date, width: 100 };
    const overdue: ColDef<CommerceRecord> = { headerName: 'Days late', valueGetter: (p) => (!p.node?.rowPinned && p.data && lifecycleOf(p.data) === 'awaiting_payment' ? daysOverdue(p.data) : null), width: 110, type: 'rightAligned', filter: 'agNumberColumnFilter' };
    const reminders: ColDef<CommerceRecord> = { headerName: 'Nudges', field: 'reminders', width: 95, type: 'rightAligned', enableCellChangeFlash: true };
    const created: ColDef<CommerceRecord> = { headerName: 'Created', field: 'createdAt', valueFormatter: date, width: 105, sort: view === 'overdue' ? undefined : 'desc' };
    const actions: ColDef<CommerceRecord> = { headerName: '', cellRenderer: ActionsCell, width: 215, pinned: 'right', sortable: false, filter: false, resizable: false };

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
      return [{ ...ref, width: 100 }, { ...customer, minWidth: 150 }, { ...overdue, width: 90 }, { ...amount, width: 95 }, { ...reminders, width: 80 }, { ...actions, width: 150, cellRendererParams: { compact: true } }];
    }
    if (view === 'order') return [ref, customer, amount, status, paid, items, { headerName: 'Tracking', field: 'trackingNumber', cellClass: 'mono', width: 150 }, created, actions];
    if (view === 'invoice') return [ref, customer, amount, status, paid, items, due, reminders, created, actions];
    return [ref, customer, kind, amount, status, paid, items, due, created, actions];
  }, [view]);

  const rowClassRules = useMemo<RowClassRules<CommerceRecord>>(
    () => ({ 'row-overdue': (p) => Boolean(p.data && lifecycleOf(p.data) === 'awaiting_payment' && daysOverdue(p.data) > 0) }),
    [],
  );

  const totals = useMemo(() => {
    const usd = data.filter((r) => r.currency === 'USD');
    if (!usd.length) return [];
    return [{ id: '__total', kind: 'invoice', customerName: `Total (USD, ${usd.length} rows)`, currency: 'USD', amount: usd.reduce((a, r) => a + r.amount, 0), paid: usd.reduce((a, r) => a + r.paid, 0), refunded: usd.reduce((a, r) => a + r.refunded, 0), items: [], status: '', createdAt: '', reminders: usd.reduce((a, r) => a + r.reminders, 0), source: 'mock', updatedAt: '' } as unknown as CommerceRecord];
  }, [data]);

  return (
    <div className={`grid-wrap ${height === 'tall' ? 'tall' : ''}`}>
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
          tooltipShowDelay={400}
          animateRows
          pagination={data.length > 50}
          paginationPageSize={50}
          overlayNoRowsTemplate="<span style='color:#8a97ab'>Nothing here yet. Paste an order into the Agent inbox.</span>"
        />
      </AgGridProvider>
    </div>
  );
}
