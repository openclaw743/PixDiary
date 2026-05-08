import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Icon or trailing element rendered after the label. */
  trailing?: ReactNode;
}

/**
 * Primary (`accent.700`) — the only saturated background per design-system
 * README ("at most one accent surface visible at rest"). 5.5:1 contrast on
 * white text per accessibility.md.
 */
const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-accent-700 text-surface-card hover:bg-accent-600 active:bg-accent-700 disabled:bg-ink-300 disabled:text-ink-500',
  secondary:
    'bg-surface-card text-ink-900 border border-border-strong hover:bg-surface-raised disabled:text-ink-400',
  ghost:
    'bg-transparent text-ink-900 hover:bg-surface-raised disabled:text-ink-400',
  danger:
    'bg-danger text-surface-card hover:opacity-90 disabled:bg-ink-300 disabled:text-ink-500',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm rounded-sm',
  md: 'h-10 px-4 text-base rounded-md',
  lg: 'h-12 px-6 text-lg rounded-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    children,
    className = '',
    type = 'button',
    trailing,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'duration-base ease-standard',
        'disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <span aria-hidden="true" className="inline-block">
          …
        </span>
      ) : null}
      <span>{children}</span>
      {trailing ? <span aria-hidden="true">{trailing}</span> : null}
    </button>
  );
});
