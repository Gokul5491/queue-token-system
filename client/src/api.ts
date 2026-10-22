export const API = (import.meta.env.VITE_API_URL as string | undefined) || '';

export type QHistoryItem = {
  number: number;
  service_minutes?: number | null;
  status: 'served' | 'skipped';
};

export type QState = {
  id: string;
  name: string;
  paused: boolean;
  nowServing: number;
  avgMinutes: number;
  servedCount: number;
  skippedCount?: number;
  todayServed?: number;
  todaySkipped?: number;
  waiting: { number: number }[];
  skipped?: number[];
  history?: QHistoryItem[];
};

export async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const r = await fetch(API + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || 'Request failed');
  return body as T;
}
