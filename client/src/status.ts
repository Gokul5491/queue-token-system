import type { QState } from './api';

export type TicketStatus =
  | { kind: 'waiting'; position: number }
  | { kind: 'called' }
  | { kind: 'served' }
  | { kind: 'skipped' };

// A ticket is in one of four states:
// - called (currently at counter)
// - waiting (in line with position)
// - skipped (called but skipped by owner)
// - served (finished)
export function ticketStatus(state: QState, number: number): TicketStatus {
  if (state.nowServing === number) return { kind: 'called' };
  const index = state.waiting.findIndex((w) => w.number === number);
  if (index >= 0) return { kind: 'waiting', position: index + 1 };

  // Check if explicitly recorded as skipped
  if (state.skipped?.includes(number)) return { kind: 'skipped' };
  const hist = state.history?.find((h) => h.number === number);
  if (hist?.status === 'skipped') return { kind: 'skipped' };

  // If the ticket number is greater than what has been called or finished, it is waiting
  const totalFinished = (state.servedCount || 0) + (state.skippedCount || 0);
  if (number > state.nowServing && number > totalFinished) {
    return { kind: 'waiting', position: Math.max(1, state.waiting.length + 1) };
  }

  return { kind: 'served' };
}
