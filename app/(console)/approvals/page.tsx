'use client';
import { Topbar } from '@/components/Topbar';
import { toastFor, useToast } from '@/components/Toasts';
import { postJson, useLive } from '@/components/useLive';
import type { Approval } from '@/lib/db/repo';
import type { DispatchResult } from '@/lib/actions';

export default function Approvals() {
  const { data } = useLive<{ approvals: Approval[] }>('/api/approvals');
  const toast = useToast();
  const pending = data?.approvals.filter((a) => a.status === 'pending') ?? [];
  const done = data?.approvals.filter((a) => a.status !== 'pending') ?? [];

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    try {
      const r = await postJson<{ approval: Approval; result?: DispatchResult; error?: string }>(`/api/approvals/${id}`, { decision });
      if (r.error) throw new Error(r.error);
      if (r.result) toastFor(toast, r.result);
      else toast(decision === 'reject' ? 'Rejected. Nothing was sent to PayPal.' : `Already ${r.approval.status}.`, 'info');
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  return (
    <>
      <Topbar title="Approvals" />
      <div className="content">
        <div className="card">
          <div className="card-h"><h2>Waiting for you</h2><span className="muted">nothing here has touched PayPal yet</span></div>
          {pending.map((a) => (
            <div key={a.id} className="approval">
              <div>
                <div className="t">{a.summary}</div>
                <div className="r">Requested by {a.requestedBy} · {a.action} · {new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                <div className="r">Why: {a.reasons.join(' ')}</div>
              </div>
              <div className="acts">
                <button className="btn" onClick={() => decide(a.id, 'reject')}>Reject</button>
                <button className="btn primary" onClick={() => decide(a.id, 'approve')}>Approve &amp; run</button>
              </div>
            </div>
          ))}
          {!pending.length && <div className="empty">All clear. The agent will park anything above your limits here.</div>}
        </div>
        <div className="card">
          <div className="card-h"><h2>History</h2></div>
          {done.map((a) => (
            <div key={a.id} className="approval">
              <div>
                <div className="t">{a.summary}</div>
                <div className="r">{a.status} by {a.decidedBy ?? 'n/a'} · {a.decidedAt ? new Date(a.decidedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}{a.error ? ` · ${a.error}` : ''}</div>
              </div>
              <span className={`pill ${a.status}`}>{a.status}</span>
            </div>
          ))}
          {!done.length && <div className="empty">No decisions yet.</div>}
        </div>
      </div>
    </>
  );
}
