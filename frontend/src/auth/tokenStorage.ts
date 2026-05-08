/**
 * Token storage.
 *
 * Per accessibility/security spec (CONVENTIONS.md, ARCHITECTURE.md):
 * - access token: short-lived (15min), held in sessionStorage so it dies with
 *   the tab. Acceptable trade-off for an MVP without httpOnly cookies.
 * - refresh token: NEVER in localStorage (XSS persistence risk). We keep it
 *   in sessionStorage too — the auth flow rotates it on every refresh, so
 *   exposure window is bounded by tab lifetime.
 *
 * Anything that touches refresh tokens MUST go through this module so we
 * have a single audit point.
 */

const ACCESS_KEY = 'pixdiary.accessToken';
const REFRESH_KEY = 'pixdiary.refreshToken';

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return safeStorage()?.getItem(ACCESS_KEY) ?? null;
}

export function getRefreshToken(): string | null {
  return safeStorage()?.getItem(REFRESH_KEY) ?? null;
}

export function setTokens(accessToken: string, refreshToken: string): void {
  const s = safeStorage();
  if (!s) return;
  s.setItem(ACCESS_KEY, accessToken);
  s.setItem(REFRESH_KEY, refreshToken);
  // Defensive: ensure no refresh token ever lives in localStorage even if a
  // future contributor wires it there by accident.
  try {
    window.localStorage.removeItem(REFRESH_KEY);
    window.localStorage.removeItem(ACCESS_KEY);
  } catch {
    // ignore
  }
}

export function clearTokens(): void {
  const s = safeStorage();
  if (!s) return;
  s.removeItem(ACCESS_KEY);
  s.removeItem(REFRESH_KEY);
}
