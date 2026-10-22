import type { QState } from './api';

export type TicketStatus =
  | { kind: 'waiting'; position: number }
  | { kind: 'called' }
  | { kind: 'served' };

// A ticket is in one of three states: called (currently at the counter),
// waiting (in line), or served (already finished).
export function ticketStatus(state: QState, number: number): TicketStatus {
  if (state.nowServing === number) return { kind: 'called' };
  const index = state.waiting.findIndex((w) => w.number === number);
  if (index >= 0) return { kind: 'waiting', position: index + 1 };

  // If the ticket number is greater than what has been called or served,
  // it is waiting (e.g. state update is still in flight right after joining).
  if (number > state.nowServing && number > state.servedCount) {
    return { kind: 'waiting', position: Math.max(1, state.waiting.length + 1) };
  }

  return { kind: 'served' };
}
