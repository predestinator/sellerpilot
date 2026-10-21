'use client';
import Link from 'next/link';
import { RecordsGrid } from '@/components/grid/RecordsGrid';
import { Topbar } from '@/components/Topbar';
import { toastFor, useToast } from '@/components/Toasts';
import { postJson, useLive } from '@/components/useLive';
import { useRowActions } from '@/components/useRowActions';
import type { CommerceRecord } from '@/lib/domain';
import type { DispatchResult } from '@/lib/actions';

type Summary = { collectedUsd: number; outstandingUsd: number; overdueUsd: number; overdueCount: number; refundedUsd: number; pendingApprovals: number; records: number; nonUsdOpen: { amount: number; currency: string }[] };
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function Overview() {
  const { data } = useLive<{ records: CommerceRecord[]; summary: Summary }>('/api/records');
  const audit = useLive<{ entries: { seq: number; at: string; actor: string; action: string; outcome: string; detail?: { summary?: string } }[] }>('/api/audit');
  const { onAction, dialog } = useRowActions();
  const toast = useToast();
  const s = data?.summary;

  const collect = async () => {
    const r = await postJson<{ plan: unknown[]; results: DispatchResult[] }>('/api/collections');
    if (!r.results.length) toast('Collections agent: nobody needs a nudge right now.', 'ok');
    r.results.forEach((x) => toastFor(toast, x));
  };

  return (
    <>
      <Topbar title="Overview">
        <Link className="btn primary" href="/inbox">✦ New order from chat</Link>
      </Topbar>
      <div className="content">
        <div className="kpis">
          <div className="card kpi ok"><div className="label">Collected</div><div className="value">{s ? usd(s.collectedUsd) : '…'}</div><div className="sub">via PayPal, USD</div></div>
          <div className="card kpi"><div className="label">Outstanding</div><div className="value">{s ? usd(s.outstandingUsd) : '…'}</div><div className="sub">{s?.nonUsdOpen.length ? `+ ${s.nonUsdOpen.map((x) => `${x.amount} ${x.currency}`).join(', ')}` : 'awaiting buyers'}</div></div>
          <div className="card kpi bad"><div className="label">Overdue</div><div className="value">{s ? usd(s.overdueUsd) : '…'}</div><div className="sub">{s?.overdueCount ?? 0} invoice(s) past due</div></div>
          <div className="card kpi"><div className="label">Refunded</div><div className="value">{s ? usd(s.refundedUsd) : '…'}</div><div className="sub">across captured orders</div></div>
          <div className="card kpi warn"><div className="label">Needs you</div><div className="value">{s?.pendingApprovals ?? '…'}</div><div className="sub"><Link href="/approvals">approval queue →</Link></div></div>
        </div>

        <div className="split">
          <div className="card">
            <div className="card-h">
              <h2>Who still owes me</h2>
              <span className="muted">overdue invoices, worst first</span>
              <div className="grow" />
              <button className="btn" onClick={collect} title="Runs the collections agent: friendly/firm/final nudges by days overdue; final notices need approval">Run collections agent</button>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <RecordsGrid rows={data?.records ?? []} view="overdue" onAction={onAction} height="normal" />
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Agent activity</h2><div className="grow" /><Link href="/activity">Full log →</Link></div>
            <div>
              {(audit.data?.entries ?? []).slice(0, 12).map((e) => (
                <div key={e.seq} className="approval" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <div className="t">{e.detail?.summary ?? e.action}</div>
                    <div className="r">{e.actor} · {e.action} · {new Date(e.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                  </div>
                  <span className={`pill ${e.outcome}`}>{e.outcome.replace('_', ' ')}</span>
                </div>
              ))}
              {audit.data && !audit.data.entries.length && <div className="empty">No activity yet.</div>}
            </div>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Analytics dashboard (AG Studio + Studio Agent Framework) lands in milestone M4; it reads the same records feed (<code>/api/records</code>).
        </p>
      </div>
      {dialog}
    </>
  );
}
