/**
 * The collections agent tick: scans unpaid invoices and nudges the overdue ones through
 * the same policy-gated dispatch. Tone escalates with days overdue; final notices need a
 * human sign-off (policy). Runs from POST /api/cron/collections or the "Run collections" button.
 */
import { dispatch, remindersToday, type DispatchResult } from './actions';
import { records } from './db/repo';
import { daysOverdue, lifecycleOf } from './domain';

export function toneFor(overdue: number): 'friendly' | 'firm' | 'final' {
  if (overdue >= 14) return 'final';
  if (overdue >= 7) return 'firm';
  return 'friendly';
}

export type CollectionsPlanItem = { invoiceId: string; customer: string; overdue: number; tone: 'friendly' | 'firm' | 'final' };

export function planCollections(now = new Date()): CollectionsPlanItem[] {
  return records
    .list('invoice')
    .filter((r) => lifecycleOf(r) === 'awaiting_payment')
    .map((r) => ({ r, overdue: daysOverdue(r, now) }))
    .filter(({ r, overdue }) => {
      if (overdue < 1) return false;
      if (remindersToday(r, now) >= 2) return false;
      // At most one automated nudge per ~day per invoice.
      const last = r.lastReminderAt ? new Date(r.lastReminderAt).getTime() : 0;
      return now.getTime() - last > 20 * 3_600_000;
    })
    .sort((a, b) => b.overdue - a.overdue)
    .map(({ r, overdue }) => ({ invoiceId: r.id, customer: r.customerName, overdue, tone: toneFor(overdue) }));
}

export async function runCollections(now = new Date()): Promise<{ plan: CollectionsPlanItem[]; results: DispatchResult[] }> {
  const plan = planCollections(now);
  const results: DispatchResult[] = [];
  for (const p of plan) results.push(await dispatch('send_reminder', { invoiceId: p.invoiceId, tone: p.tone }, 'collections'));
  return { plan, results };
}
