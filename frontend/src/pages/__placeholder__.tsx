import { Link } from 'react-router-dom';

interface PlaceholderProps {
  title: string;
  description?: string;
}

/**
 * Generic "coming soon" placeholder used by routes whose UI is shipped in
 * issue #10. Keeping the route alive (instead of returning 404) lets us link
 * to it from nav and keeps the auth-redirect flow honest.
 */
export default function PlaceholderPage({ title, description }: PlaceholderProps) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-start justify-center gap-4 px-4 py-12">
      <p className="text-sm uppercase tracking-wide text-ink-500">PixDiary</p>
      <h1 className="font-heading text-4xl font-semibold text-ink-900">{title}</h1>
      <p className="text-lg text-ink-700">
        {description ?? 'Coming soon. This screen ships in the next milestone.'}
      </p>
      <Link to="/login" className="text-base font-medium text-accent-700 underline">
        Back to sign in
      </Link>
    </main>
  );
}
