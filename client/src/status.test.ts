import { describe, expect, it } from 'vitest';
import type { QState } from './api';
import { ticketStatus } from './status';

const base: QState = { id: 'ABC234', name: 'Clinic', paused: false, nowServing: 0, avgMinutes: 5, servedCount: 0, waiting: [] };
const state = (over: Partial<QState>): QState => ({ ...base, ...over });

describe('ticketStatus', () => {
  it('reports the position for a waiting ticket, counting from 1', () => {
    const s = state({ nowServing: 1, waiting: [{ number: 2 }, { number: 3 }] });
    expect(ticketStatus(s, 2)).toEqual({ kind: 'waiting', position: 1 });
    expect(ticketStatus(s, 3)).toEqual({ kind: 'waiting', position: 2 });
  });
  it('reports called for the number being served', () => {
    expect(ticketStatus(state({ nowServing: 2, waiting: [{ number: 3 }] }), 2)).toEqual({ kind: 'called' });
  });
  it('reports served once the owner has moved on to the next number', () => {
    expect(ticketStatus(state({ nowServing: 2, servedCount: 1, waiting: [{ number: 3 }] }), 1)).toEqual({ kind: 'served' });
  });
  it('reports served when the last customer was finished and nobody is being served', () => {
    expect(ticketStatus(state({ nowServing: 0, servedCount: 2 }), 2)).toEqual({ kind: 'served' });
  });
  it('reports waiting when a newly joined ticket is not yet in the state waiting array', () => {
    // Ticket 4 just created, but state only has 2 and 3 so far
    const s = state({ nowServing: 1, servedCount: 0, waiting: [{ number: 2 }, { number: 3 }] });
    expect(ticketStatus(s, 4)).toEqual({ kind: 'waiting', position: 3 });
  });
  it('reports skipped when ticket is in state.skipped array', () => {
    const s = state({ nowServing: 3, servedCount: 1, skippedCount: 1, skipped: [2], waiting: [{ number: 4 }] });
    expect(ticketStatus(s, 2)).toEqual({ kind: 'skipped' });
    expect(ticketStatus(s, 1)).toEqual({ kind: 'served' });
    expect(ticketStatus(s, 3)).toEqual({ kind: 'called' });
    expect(ticketStatus(s, 4)).toEqual({ kind: 'waiting', position: 1 });
  });
  it('reports skipped when ticket is in history with status skipped', () => {
    const s = state({
      nowServing: 0,
      servedCount: 1,
      skippedCount: 1,
      history: [
        { number: 1, status: 'served', service_minutes: 5 },
        { number: 2, status: 'skipped', service_minutes: null },
      ],
    });
    expect(ticketStatus(s, 1)).toEqual({ kind: 'served' });
    expect(ticketStatus(s, 2)).toEqual({ kind: 'skipped' });
  });
});
