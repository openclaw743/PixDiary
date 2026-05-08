import { Link } from 'react-router-dom';

import { Banner } from '@/components/Banner';

/**
 * Standardised "daily AI quota reached" banner used by both upload and entry
 * screens. Body copy and link target match wireframes 01-upload.md §E and
 * 02-entry.md §F.
 */
export function QuotaBlockedBanner({ capEur }: { capEur?: number }) {
  const cap = typeof capEur === 'number' ? `€${capEur.toFixed(2)}` : null;
  return (
    <Banner tone="warning" title="Daily AI quota reached">
      <p>
        {cap
          ? `New entries pause until tomorrow. Today's cap is ${cap}.`
          : 'New entries pause until tomorrow.'}{' '}
        <Link to="/settings" className="font-medium text-accent-700 underline">
          Raise limit in Settings →
        </Link>
      </p>
    </Banner>
  );
}
