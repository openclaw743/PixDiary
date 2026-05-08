import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode;
  /** Inline help text rendered below the input. */
  hint?: ReactNode;
  /** Inline error message; sets `aria-invalid` and links via `aria-describedby`. */
  error?: ReactNode;
}

/**
 * Form input primitive.
 *
 * Per accessibility.md:
 *  - every input has a visible <label> (placeholders are NOT labels).
 *  - errors render below the field with role-conscious aria wiring.
 *  - focus ring is global (3px accent.700) — no per-input override.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className = '', ...rest },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `input-${reactId}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-800">
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={[
          'h-10 rounded-sm border bg-surface-card px-3 text-base text-ink-900',
          'placeholder:text-ink-400',
          invalid ? 'border-danger' : 'border-border-strong',
          'transition-colors duration-fast ease-standard',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      {hint && !error ? (
        <p id={hintId} className="text-sm text-ink-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1 text-sm text-danger"
        >
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
});
