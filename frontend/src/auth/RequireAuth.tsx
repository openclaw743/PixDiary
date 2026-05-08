import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';

/**
 * Redirects unauthenticated users to /login while preserving the original
 * location in router state so they can be sent back after sign-in.
 */
export function RequireAuth({ children }: { children: ReactElement }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-screen items-center justify-center text-ink-700"
      >
        Loading…
      </div>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
