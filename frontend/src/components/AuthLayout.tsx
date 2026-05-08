import type { ReactNode } from 'react';

/**
 * Centred, paper-card layout for the auth screens. Keeps Login + Signup
 * visually consistent and gives the form a card surface against the cream
 * page background.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-page px-4 py-12">
      <section className="w-full max-w-md">
        <header className="mb-6 text-center">
          <p
            aria-hidden="true"
            className="font-heading text-4xl font-bold tracking-tight text-accent-700"
          >
            PixDiary
          </p>
          <h1 className="mt-4 font-heading text-3xl font-semibold text-ink-900">{title}</h1>
          {subtitle ? <p className="mt-2 text-ink-700">{subtitle}</p> : null}
        </header>
        <div className="rounded-lg border border-border-subtle bg-surface-card p-6 shadow-md">
          {children}
        </div>
        {footer ? (
          <p className="mt-6 text-center text-sm text-ink-700">{footer}</p>
        ) : null}
      </section>
    </main>
  );
}
