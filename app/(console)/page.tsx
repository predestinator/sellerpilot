'use client';
import Link from 'next/link';
import { ApprovalsGrid } from '@/components/grid/ApprovalsGrid';
import { RecordsGrid } from '@/components/grid/RecordsGrid';
import { KpiStrip, type Summary } from '@/components/KpiStrip';
import { Topbar } from '@/components/Topbar';
import { toastFor, useToast } from '@/components/Toasts';
import { useApprovalDecision } from '@/components/useApprovalDecision';
import { postJson, useLive } from '@/components/useLive';
import { useRowActions } from '@/components/useRowActions';
import type { CommerceRecord } from '@/lib/domain';
import type { Approval } from '@/lib/db/repo';
import type { DispatchResult } from '@/lib/actions';

export default function Overview() {
  const { data } = useLive<{ records: CommerceRecord[]; summary: Summary }>('/api/records');
  const appr = useLive<{ approvals: Approval[] }>('/api/approvals');
  const audit = useLive<{ entries: { seq: number; at: string; actor: string; action: string; outcome: string; detail?: { summary?: string } }[] }>('/api/audit');
  const status = useLive<{ policy: { approvalThresholdUsd: number; refundAutoLimitUsd: number } }>('/api/status');
  const limit = status.data?.policy.approvalThresholdUsd ?? 150;
  const refundLimit = status.data?.policy.refundAutoLimitUsd ?? 50;
  const { onAction, dialog } = useRowActions();
  const { decide } = useApprovalDecision();
  const toast = useToast();
  const pending = appr.data?.approvals.filter((a) => a.status === 'pending') ?? [];

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
        <section className="card hero" aria-label="What SellerPilot does">
          <div className="pitch">
            <h2>Get paid from abroad without the admin.</h2>
            <p>
              SellerPilot is an AI back office for small sellers who take orders in social DMs and chat apps and get paid through PayPal.
              Paste a chat message or a screenshot and the agent drafts the PayPal invoice or checkout link, tracks the payment,
              chases late buyers, then captures, ships and refunds. Anything risky waits for your approval first.
            </p>
            <div className="flow" aria-label="Flow">
              <span>Chat / screenshot</span><i>→</i><span>PayPal invoice or checkout</span><i>→</i><span>Payment tracked</span><i>→</i><span>Reminders</span><i>→</i><span>Capture · ship · refund</span>
            </div>
            <div className="ctas">
              <Link className="btn primary" href="/inbox">✦ Try the agent</Link>
              <Link className="btn" href="/orders">▤ Open the dashboard</Link>
              <Link className="btn" href="/approvals">✓ Approval queue{pending.length ? ` (${pending.length})` : ''}</Link>
            </div>
          </div>
          <ol className="steps">
            <li><div><b>Paste an order</b><span>In the Agent inbox, try “Invoice Ethan Clarke ethan@example.com for a wedding portrait $420”, or drop a chat screenshot.</span></div></li>
            <li><div><b>Watch the guardrails</b><span>Invoices over ${limit}, refunds over ${refundLimit}, first-time buyers and final notices are parked for you to approve or reject. Small stuff just runs.</span></div></li>
            <li><div><b>Work the grid</b><span>Orders &amp; invoices: filter by status, search, remind, capture, track and refund in one row. Every step lands in the activity log.</span></div></li>
          </ol>
        </section>

        <KpiStrip s={data?.summary} approvals={appr.data?.approvals} />

        {pending.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-h">
              <h2>Needs your approval</h2>
              <span className="muted">held by the guardrails; nothing has touched PayPal yet</span>
              <div className="grow" />
              <Link href="/approvals">All approvals →</Link>
            </div>
            <ApprovalsGrid rows={pending} decide={decide} />
          </div>
        )}

        <div className="split">
          <div className="card">
            <div className="card-h">
              <h2>Who still owes me</h2>
              <span className="muted">overdue, worst first</span>
              <div className="grow" />
              <button className="btn" onClick={collect} title="Runs the collections agent: friendly/firm/final nudges by days overdue; final notices need approval">Run collections agent</button>
            </div>
            <div className="card-b" style={{ padding: 0 }}>
              <RecordsGrid rows={data?.records ?? []} view="overdue" onAction={onAction} height="auto" />
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h2>Agent activity</h2><div className="grow" /><Link href="/activity">Full log →</Link></div>
            <div>
              {(audit.data?.entries ?? []).slice(0, 10).map((e) => (
                <div key={e.seq} className="approval" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div>
                    <div className="t">{e.detail?.summary ?? e.action}</div>
                    <div className="r">{e.actor} · {e.action} · {new Date(e.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST</div>
                  </div>
                  <span className={`pill ${e.outcome}`}>{e.outcome.replace('_', ' ')}</span>
                </div>
              ))}
              {audit.data && !audit.data.entries.length && <div className="empty">No activity yet.</div>}
            </div>
          </div>
        </div>
      </div>
      {dialog}
    </>
  );
}
