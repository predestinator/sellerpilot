'use client';
import { ApprovalsGrid } from '@/components/grid/ApprovalsGrid';
import { Topbar } from '@/components/Topbar';
import { useApprovalDecision } from '@/components/useApprovalDecision';
import { useLive } from '@/components/useLive';
import type { Approval } from '@/lib/db/repo';

export default function Approvals() {
  const { data } = useLive<{ approvals: Approval[] }>('/api/approvals');
  const status = useLive<{ policy: { approvalThresholdUsd: number; refundAutoLimitUsd: number } }>('/api/status');
  const { decide } = useApprovalDecision();
  const pending = data?.approvals.filter((a) => a.status === 'pending') ?? [];
  const done = data?.approvals.filter((a) => a.status !== 'pending') ?? [];
  const p = status.data?.policy;

  return (
    <>
      <Topbar title="Approvals" />
      <div className="content">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-h">
            <h2>Waiting for you ({pending.length})</h2>
            <span className="muted">nothing here has touched PayPal yet</span>
            <div className="grow" />
            {p && <span className="muted">Guardrails: invoices/links over ${p.approvalThresholdUsd}, refunds over ${p.refundAutoLimitUsd}, first-time buyers, final notices, cancellations</span>}
          </div>
          <ApprovalsGrid rows={pending} decide={decide} />
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-h"><h2>History</h2><span className="muted">every decision is in the audit log</span></div>
          <ApprovalsGrid rows={done} decide={decide} mode="history" />
        </div>
      </div>
    </>
  );
}
