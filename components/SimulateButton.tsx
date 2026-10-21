'use client';
import { useState } from 'react';

export function SimulateButton({ op, id, label }: { op: 'pay_invoice' | 'approve_order'; id: string; label: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>('idle');
  const go = async () => {
    setState('busy');
    const r = await fetch('/api/mock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id }) });
    const j = await r.json();
    setState(r.ok ? 'done' : (j.error ?? 'failed'));
  };
  if (state === 'done') return <p style={{ color: 'var(--ok)', fontWeight: 600 }}>✓ Done. SellerPilot received the event; check the dashboard.</p>;
  return (
    <>
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 12 }} onClick={go} disabled={state === 'busy'}>
        {state === 'busy' ? 'Processing…' : label}
      </button>
      {state !== 'idle' && state !== 'busy' && <p style={{ color: 'var(--bad)' }}>{state}</p>}
    </>
  );
}
