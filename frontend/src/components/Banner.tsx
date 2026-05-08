import type { ReactNode } from 'react';

type Tone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone?: Tone;
  title?: ReactNode;
  children: ReactNode;
  /** Whether the banner is rendered as an aria-live region. Defaults to true. */
  live?: boolean;
}

const TONE_STYLES: Record<Tone, { wrap: string; icon: string; iconColor: string }> = {
  info: {
    wrap: 'bg-surface-raised border-border-strong text-ink-900',
    icon: 'ℹ',
    iconColor: 'text-ink-700',
  },
  success: {
    wrap: 'bg-surface-raised border-success text-ink-900',
    icon: '✓',
    iconColor: 'text-success',
  },
  warning: {
    wrap: 'bg-surface-raised border-warning text-ink-900',
    icon: '⚠',
    iconColor: 'text-warning',
  },
  danger: {
    wrap: 'bg-surface-raised border-danger text-ink-900',
    icon: '⚠',
    iconColor: 'text-danger',
  },
};

/**
 * Banner — colour is never the only signal (icon + label + role).
 *
 * `danger` and `warning` set `role="alert"`; `info`/`success` use the softer
 * `role="status"`. Both are aria-live polite/assertive accordingly.
 */
export function Banner({ tone = 'info', title, children, live = true }: BannerProps) {
  const styles = TONE_STYLES[tone];
  const role = live ? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status') : undefined;
  return (
    <div
      role={role}
      className={[
        'flex items-start gap-3 rounded-md border px-4 py-3',
        styles.wrap,
      ].join(' ')}
    >
      <span aria-hidden="true" className={`text-lg leading-6 ${styles.iconColor}`}>
        {styles.icon}
      </span>
      <div className="flex-1 text-sm">
        {title ? <p className="font-semibold text-ink-900">{title}</p> : null}
        <div className="text-ink-800">{children}</div>
      </div>
    </div>
  );
}
