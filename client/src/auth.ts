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

export const COGNITO_REGION = 'ap-south-1';
export const COGNITO_CLIENT_ID = 'u4svfjkcl6vmq7glgtp8vhcel';
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;

const TOKEN_KEY = 'cognito_id_token';
const USER_KEY = 'cognito_user';

let currentToken: string | null = null;
let currentUser: AuthUser | null = null;
const listeners = new Set<(user: AuthUser | null) => void>();

function parseJwt(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

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
  return currentToken ? { Authorization: `Bearer ${currentToken}`, 'x-auth-token': `Bearer ${currentToken}` } : {};
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

export async function loginWithCognitoDirect(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(COGNITO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email.trim().toLowerCase(),
        PASSWORD: password,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.__type) {
    const msg = data.message || data.__type || 'Authentication failed';
    throw new Error(msg);
  }
  const result = data.AuthenticationResult;
  const payload = parseJwt(result.IdToken);
  const groups: string[] = payload?.['cognito:groups'] || [];
  let role: UserRole = 'Customer';
  if (groups.includes('Admin')) role = 'Admin';
  else if (groups.includes('Owner')) role = 'Owner';

  return {
    idToken: result.IdToken,
    accessToken: result.AccessToken,
    refreshToken: result.RefreshToken,
    expiresIn: result.ExpiresIn,
    user: {
      id: payload?.sub || '',
      email: payload?.email || email,
      name: payload?.name || email.split('@')[0],
      role,
      groups,
    },
  };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  try {
    const res = await loginWithCognitoDirect(email, password);
    setSession(res);
    return res.user;
  } catch (err: any) {
    try {
      const res = await req<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setSession(res);
      return res.user;
    } catch {
      throw err;
    }
  }
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
