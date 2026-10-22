// AWS Cognito Authentication client state and API helpers
import { req } from './api';

export type UserRole = 'Owner' | 'Customer' | 'Admin';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  groups: string[];
};

export type AuthResponse = {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  user: AuthUser;
};

const TOKEN_KEY = 'cognito_id_token';
const USER_KEY = 'cognito_user';

let currentToken: string | null = null;
let currentUser: AuthUser | null = null;
const listeners = new Set<(user: AuthUser | null) => void>();

export function initAuth() {
  try {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (savedToken && savedUser) {
      currentToken = savedToken;
      currentUser = JSON.parse(savedUser);
    }
  } catch {}
}

export function subscribeAuth(fn: (user: AuthUser | null) => void) {
  listeners.add(fn);
  fn(currentUser);
  return () => { listeners.delete(fn); };
}

export function getAuthToken(): string | null {
  return currentToken;
}

export function getCurrentUser(): AuthUser | null {
  return currentUser;
}

export function getAuthHeaders(): Record<string, string> {
  return currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
}

function setSession(res: AuthResponse | null) {
  if (res && res.idToken && res.user) {
    currentToken = res.idToken;
    currentUser = res.user;
    localStorage.setItem(TOKEN_KEY, res.idToken);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  } else {
    currentToken = null;
    currentUser = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  listeners.forEach((fn) => fn(currentUser));
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await req<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setSession(res);
  return res.user;
}

export async function register(
  email: string,
  password: string,
  name: string,
  role: UserRole = 'Customer'
): Promise<AuthUser> {
  const res = await req<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name, role }),
  });
  setSession(res);
  return res.user;
}

export function logout() {
  setSession(null);
}
