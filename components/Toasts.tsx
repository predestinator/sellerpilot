'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'bad' | 'warn' | 'info';
type Toast = { id: number; text: string; tone: Tone };
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Tone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Turn a DispatchResult from /api/actions into a toast. */
export function toastFor(push: (t: string, tone?: Tone) => void, r: { status: string; summary?: string; reasons?: string[]; error?: string }) {
  if (r.status === 'done') push(`✓ ${r.summary}`, 'ok');
  else if (r.status === 'pending_approval') push(`Queued for approval: ${r.summary}`, 'warn');
  else if (r.status === 'denied') push(`Blocked: ${r.reasons?.join(' ')}`, 'bad');
  else push(`Failed: ${r.error ?? 'unknown error'}`, 'bad');
}
