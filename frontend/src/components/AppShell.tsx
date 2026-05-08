import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';

import { useAuth } from '@/auth/AuthContext';

/**
 * Top nav + main shell used by every authenticated screen.
 *
 * Provides skip-to-content link, brand mark, calendar/upload/settings entry
 * points, and a logout button. Per accessibility.md, every page has a single
 * `<main>` landmark — pages render their own `<h1>` inside.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      <a
        href="#app-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-toast focus:rounded-sm focus:bg-surface-card focus:px-3 focus:py-2 focus:text-ink-900 focus:shadow-md"
      >
        Skip to main content
      </a>
      <header className="border-b border-border-subtle bg-surface-page">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"
        >
          <Link to="/" className="font-heading text-2xl font-bold text-accent-700">
            PixDiary
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <NavTab to="/upload">+ New entry</NavTab>
            <NavTab to="/calendar">Calendar</NavTab>
            <NavTab to="/settings" aria-label="Settings">
              <span aria-hidden="true">⚙</span>
              <span className="sr-only">Settings</span>
            </NavTab>
            {user ? (
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                className="ml-2 rounded-sm px-3 py-2 text-ink-700 hover:bg-surface-raised"
              >
                Sign out
              </button>
            ) : null}
          </div>
        </nav>
      </header>
      <main id="app-main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}

function NavTab({
  to,
  children,
  ...rest
}: {
  to: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'rounded-sm px-3 py-2 transition-colors',
          'duration-fast ease-standard',
          isActive
            ? 'bg-surface-raised text-ink-900'
            : 'text-ink-700 hover:bg-surface-raised',
        ].join(' ')
      }
      {...rest}
    >
      {children}
    </NavLink>
  );
}
