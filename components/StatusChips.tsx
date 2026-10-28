'use client';
import { useEffect, useState } from 'react';

type Status = { paypal: { mode: string; requestedMode: string; hasCredentials: boolean }; llm: string; policy: { approvalThresholdUsd: number; refundAutoLimitUsd: number } };

export function StatusChips() {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    fetch('/api/status').then((r) => r.json()).then(setS).catch(() => setS(null));
  }, []);
  if (!s) return null;
  const connected = s.paypal.mode === 'sandbox' || s.paypal.mode === 'mock';
  const localAgent = s.llm.startsWith('offline');
  return (
    <>
      <span className={`chip ${connected ? 'ok' : 'warn'}`} title="PayPal connection">
        <span className="dot" />
        PayPal · {connected ? 'Connected' : 'Offline'}
      </span>
      <span className={`chip ${localAgent ? 'info' : 'ok'}`} title="SellerPilot agent">
        <span className="dot" />
        Agent · {localAgent ? 'Local' : 'Ready'}
      </span>
      <span className="chip" title="Actions above these amounts wait for your approval">Limits · invoices ${s.policy.approvalThresholdUsd} · refunds ${s.policy.refundAutoLimitUsd}</span>
    </>
  );
}
