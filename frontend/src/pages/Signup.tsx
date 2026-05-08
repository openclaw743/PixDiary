import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import {
  PASSWORD_MIN_LENGTH,
  passwordRulesText,
  validateEmail,
  validatePassword,
} from '@/auth/validation';
import { AuthLayout } from '@/components/AuthLayout';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

export default function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validateAll(): { email?: string; password?: string; confirm?: string } {
    const next: { email?: string; password?: string; confirm?: string } = {};
    const emailErr = validateEmail(email);
    if (emailErr) next.email = emailErr;
    const passwordErr = validatePassword(password, { strict: true });
    if (passwordErr) next.password = passwordErr;
    if (!confirm) {
      next.confirm = 'Confirm your password.';
    } else if (confirm !== password) {
      next.confirm = 'Passwords do not match.';
    }
    return next;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitError(null);

    const next = validateAll();
    setErrors(next);

    if (next.email) {
      emailRef.current?.focus();
      return;
    }
    if (next.password) {
      passwordRef.current?.focus();
      return;
    }
    if (next.confirm) {
      confirmRef.current?.focus();
      return;
    }

    setSubmitting(true);
    signup(email.trim(), password)
      .then(() => {
        navigate('/', { replace: true });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 409) {
          setSubmitError('An account with that email already exists. Try signing in instead.');
        } else if (err instanceof ApiError && err.status === 400) {
          setSubmitError(err.message || 'Please double-check the form and try again.');
        } else if (err instanceof ApiError) {
          setSubmitError(err.message || 'Could not create your account. Please try again.');
        } else {
          setSubmitError('Network error — check your connection and try again.');
        }
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  return (
    <AuthLayout
      title="Start your diary"
      subtitle="Photos in, prose out. Save your first entry in under a minute."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent-700 underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate aria-describedby="signup-error">
        <div className="flex flex-col gap-4">
          {submitError ? (
            <div id="signup-error">
              <Banner tone="danger" title="Could not sign up">
                {submitError}
              </Banner>
            </div>
          ) : null}
          <Input
            ref={emailRef}
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Input
            ref={passwordRef}
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint={passwordRulesText}
            error={errors.password}
          />
          <Input
            ref={confirmRef}
            label="Confirm password"
            type="password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          <Button type="submit" loading={submitting} className="mt-2 w-full">
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
