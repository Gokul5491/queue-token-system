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
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('cognito_id_token') : null;
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('x-auth-token')) headers.set('x-auth-token', `Bearer ${token}`);
  }
  const r = await fetch(API + path, { ...opts, headers });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || 'Request failed');
  return body as T;
}
