'use client';
import { useRef, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { postJson } from '@/components/useLive';
import { useToast } from '@/components/Toasts';
import type { AgentRunResult } from '@/lib/agent/runner';

const SAMPLES = [
  'Hi! I\'m Grace Lee from Seattle 😊 can I get 2x indigo cushion covers @ $28 each + shipping $12? email grace.lee@example.com',
  'Send a pay link: 1 brass diya set $55, shipping $15, for Tom Baker in London',
  'Invoice Ethan Clarke ethan@example.com for a custom wedding portrait $420, due in 10 days',
  'Remind everyone who is overdue',
  'Refund Hannah $20 because one tassel was loose',
  'Who still owes me?',
  'Capture approved orders',
];

type Turn = { role: 'user' | 'agent'; text: string; run?: AgentRunResult; image?: string };

export default function Inbox() {
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ data: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; preview: string } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const onFile = (f?: File) => {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast('Use a PNG, JPEG or WebP screenshot.', 'bad');
    if (f.size > 5_000_000) return toast('Screenshot must be under 5 MB.', 'bad');
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      setImage({ data: url.split(',')[1]!, mediaType: f.type as 'image/png', preview: url });
    };
    r.readAsDataURL(f);
  };

  const send = async () => {
    if (!text.trim() && !image) return;
    const userTurn: Turn = { role: 'user', text: text.trim() || '(screenshot)', image: image?.preview };
    setTurns((t) => [...t, userTurn]);
    setBusy(true);
    try {
      const run = await postJson<AgentRunResult & { error?: string }>('/api/agent', { message: text, ...(image ? { image: { data: image.data, mediaType: image.mediaType } } : {}) });
      if (run.error) throw new Error(run.error);
      setTurns((t) => [...t, { role: 'agent', text: run.text, run }]);
      setText('');
      setImage(null);
    } catch (e) {
      setTurns((t) => [...t, { role: 'agent', text: `Error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Topbar title="Agent inbox" />
      <div className="content">
        <div className="split">
          <div className="card composer">
            <div className="card-h"><h2>Paste a DM, order note or screenshot</h2></div>
            <div className="card-b">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
                onPaste={(e) => { const f = [...e.clipboardData.files][0]; if (f) { e.preventDefault(); onFile(f); } }}
                placeholder="e.g. “hey! 3 silver jhumkas at €34 each please, ship to Milan. sofia.rossi@example.it”"
                aria-label="Order message"
              />
              {image && (
                <div className="row-gap" style={{ marginTop: 8 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.preview} alt="Attached screenshot" style={{ maxHeight: 90, borderRadius: 8, border: '1px solid var(--border)' }} />
                  <button className="btn sm" onClick={() => setImage(null)}>Remove</button>
                </div>
              )}
              <div className="row">
                <button className="btn primary" onClick={send} disabled={busy}>{busy ? 'Working…' : 'Run agent  ⌘↵'}</button>
                <button className="btn" onClick={() => fileRef.current?.click()}>Attach screenshot</button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                <span className="muted" style={{ fontSize: 12 }}>The agent acts through PayPal; risky steps wait in Approvals.</span>
              </div>
              <div className="samples">
                {SAMPLES.map((s) => <button key={s} onClick={() => setText(s)}>{s.length > 58 ? `${s.slice(0, 56)}…` : s}</button>)}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-h"><h2>Conversation</h2><div className="grow" />{turns.length > 0 && <button className="btn sm" onClick={() => setTurns([])}>Clear</button>}</div>
            <div className="card-b thread">
              {!turns.length && <div className="empty">Try one of the samples. Every action shows up here with its PayPal result.</div>}
              {turns.map((t, i) => (
                <div key={i} className={`msg ${t.role}`}>
                  <div className="meta">{t.role === 'user' ? 'You' : `SellerPilot · ${t.run?.provider ?? ''}`}</div>
                  {t.image && <Thumb src={t.image} />}
                  <Linkified text={t.text} />
                  {t.run?.fallback && <div className="fallback">{t.run.fallback}</div>}
                  {t.run?.steps.map((s, j) => <StepCard key={j} step={s} />)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Thumb({ src }: { src: string }) {
  // A local data: URL preview; next/image optimisation does not apply.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Attached screenshot" style={{ maxHeight: 120, borderRadius: 8, display: 'block', marginBottom: 6 }} />;
}

function StepCard({ step }: { step: AgentRunResult['steps'][number] }) {
  const out = step.output as { status?: string; summary?: string };
  return (
    <div className="step">
      <div className="h">
        <code>{step.tool}</code>
        {out?.status && <span className={`pill ${out.status}`}>{out.status.replace('_', ' ')}</span>}
      </div>
      <details>
        <summary className="muted" style={{ cursor: 'pointer', fontSize: 12, marginTop: 4 }}>{out?.summary ?? 'details'}</summary>
        <pre>{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre>
      </details>
    </div>
  );
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return <div>{parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : <span key={i}>{p}</span>))}</div>;
}
