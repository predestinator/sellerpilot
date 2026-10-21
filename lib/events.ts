/** In-process pub/sub that feeds the SSE stream (/api/events) so grids update live. */
import { EventEmitter } from 'node:events';

export type AppEvent =
  | { type: 'record'; id: string }
  | { type: 'approval'; id: string; status: string }
  | { type: 'audit'; action: string; outcome: string };

const g = globalThis as unknown as { __spBus?: EventEmitter };
const bus = (g.__spBus ??= Object.assign(new EventEmitter(), {}).setMaxListeners(100));

export const emit = (e: AppEvent) => bus.emit('event', e);
export function subscribe(fn: (e: AppEvent) => void) {
  bus.on('event', fn);
  return () => bus.off('event', fn);
}
