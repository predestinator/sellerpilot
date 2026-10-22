'use client';
import { useCallback } from 'react';
import type { Approval } from '@/lib/db/repo';
import type { DispatchResult } from '@/lib/actions';
import { toastFor, useToast } from './Toasts';
import { postJson } from './useLive';

/** Approve/reject a parked action via POST /api/approvals/:id (the server re-checks policy before running it). */
export function useApprovalDecision() {
  const toast = useToast();
  const decide = useCallback(
    async (id: string, decision: 'approve' | 'reject') => {
      try {
        const r = await postJson<{ approval: Approval; result?: DispatchResult; error?: string }>(`/api/approvals/${id}`, { decision });
        if (r.error) throw new Error(r.error);
        if (r.result) toastFor(toast, r.result);
        else toast(decision === 'reject' ? `Rejected ${id}. Nothing was sent to PayPal.` : `${id} was already ${r.approval.status}.`, 'info');
      } catch (e) {
        toast((e as Error).message, 'bad');
      }
    },
    [toast],
  );
  return { decide };
}
