import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api, ApiError } from '@/api/client';
import type { AuthResponse, AuthUser } from '@/auth/types';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '@/auth/tokenStorage';

export interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Test seam: skip the on-mount /me hydration. */
  skipBootstrap?: boolean;
}

export function AuthProvider({ children, skipBootstrap }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>(
    skipBootstrap ? 'anonymous' : 'loading',
  );

  // On mount, if we have an access (or refresh) token in sessionStorage,
  // hydrate the user from /me. This survives an in-tab reload.
  useEffect(() => {
    if (skipBootstrap) return;
    let cancelled = false;
    const accessToken = getAccessToken();
    const refreshToken = getRefreshToken();
    if (!accessToken && !refreshToken) {
      setStatus('anonymous');
      return;
    }
    void (async () => {
      try {
        const me = await api.get<AuthUser>('/me');
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          clearTokens();
        }
        setUser(null);
        setStatus('anonymous');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skipBootstrap]);

  const handleAuthSuccess = useCallback((resp: AuthResponse): AuthUser => {
    setTokens(resp.accessToken, resp.refreshToken);
    setUser(resp.user);
    setStatus('authenticated');
    return resp.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const resp = await api.post<AuthResponse>('/auth/login', { email, password });
      return handleAuthSuccess(resp);
    },
    [handleAuthSuccess],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      const resp = await api.post<AuthResponse>('/auth/signup', { email, password });
      return handleAuthSuccess(resp);
    },
    [handleAuthSuccess],
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      try {
        await api.post('/auth/logout', { refreshToken });
      } catch {
        // best-effort; we still clear local state below
      }
    }
    clearTokens();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, signup, logout }),
    [user, status, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>');
  }
  return ctx;
}
