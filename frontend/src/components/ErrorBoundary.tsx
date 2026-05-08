import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Keeps the broken state visible enough for the user
 * to reload, without leaking stack traces to the page (production logs only).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[PixDiary] Unhandled render error:', error, info);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="font-heading text-3xl text-ink-900">Something went wrong.</h1>
          <p className="text-ink-700">
            PixDiary hit an unexpected error. Reload the page; if it keeps happening, contact
            support.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-accent-700 px-4 py-2 text-base font-medium text-surface-card"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
