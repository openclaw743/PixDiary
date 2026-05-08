/**
 * Shared form validation helpers for Login + Signup.
 *
 * Kept dumb on purpose: real validation lives server-side. These checks just
 * stop obviously bad submissions and produce a11y-grade inline messages.
 *
 * Password rules visible up-front (per accessibility.md "Password rules visible
 * up-front, not after-the-fact"): we mirror the OpenAPI minimum (10 chars).
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export const passwordRulesText = `At least ${PASSWORD_MIN_LENGTH} characters.`;

export function validateEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Email is required.';
  if (trimmed.length > 254) return 'Email is too long.';
  if (!EMAIL_PATTERN.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value: string, opts: { strict?: boolean } = {}): string | null {
  if (!value) return 'Password is required.';
  if (opts.strict) {
    if (value.length < PASSWORD_MIN_LENGTH) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }
    if (value.length > PASSWORD_MAX_LENGTH) {
      return 'Password is too long.';
    }
  }
  return null;
}
