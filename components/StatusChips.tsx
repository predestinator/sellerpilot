'use client';
import { useEffect, useState } from 'react';

type Status = { paypal: { mode: string; requestedMode: string; hasCredentials: boolean }; llm: string; policy: { approvalThresholdUsd: number; refundAutoLimitUsd: number } };

export function StatusChips() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setS).catch(() => setS(null));
  }, []);
  if (!s) return null;
  const sandbox = s.paypal.mode === 'sandbox';
  return (
    <>
      <span className={`chip ${sandbox ? 'ok' : 'warn'}`} title={sandbox ? 'Live calls to api-m.sandbox.paypal.com' : 'Offline PayPal simulator; set PAYPAL_MODE=sandbox + credentials for real sandbox calls'}>
        <span className="dot" />
        PayPal: {sandbox ? 'Sandbox' : 'Mock simulator'}
      </span>
      <span className={`chip ${s.llm.startsWith('offline') ? 'warn' : 'info'}`} title="Agent model">
        <span className="dot" />
        Agent: {s.llm.startsWith('offline') ? 'Offline planner' : s.llm}
      </span>
      <span className="chip" title="Guardrails">Auto-limit ${s.policy.approvalThresholdUsd} · refunds ${s.policy.refundAutoLimitUsd}</span>
    </>
  );
}
