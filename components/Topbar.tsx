import type { ReactNode } from 'react';
import { StatusChips } from './StatusChips';

export function Topbar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="grow" />
      {children}
      <StatusChips />
    </header>
  );
}
