import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { validateEmail, validatePassword } from '@/auth/validation';
import { AuthLayout } from '@/components/AuthLayout';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

interface LocationState {
  from?: { pathname?: string };
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo =
    (location.state as LocationState | null)?.from?.pathname ?? '/';

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setSubmitError(null);

    const emailErr = validateEmail(email);
    const passwordErr = validatePassword(password);
    const nextErrors = { email: emailErr ?? undefined, password: passwordErr ?? undefined };
    setErrors(nextErrors);

    // a11y: focus the first invalid field on submit failure.
    if (emailErr) {
      emailRef.current?.focus();
      return;
    }
    if (passwordErr) {
      passwordRef.current?.focus();
      return;
    }

    setSubmitting(true);
    login(email.trim(), password)
      .then(() => {
        navigate(redirectTo, { replace: true });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          setSubmitError('That email and password combination did not match. Try again.');
        } else if (err instanceof ApiError) {
          setSubmitError(err.message || 'Could not sign you in. Please try again.');
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
      title="Welcome back"
      subtitle="Sign in to keep writing your diary."
      footer={
        <>
          New here?{' '}
          <Link to="/signup" className="font-medium text-accent-700 underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate aria-describedby="login-error">
        <div className="flex flex-col gap-4">
          {submitError ? (
            <div id="login-error">
              <Banner tone="danger" title="Sign-in failed">
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <Button type="submit" loading={submitting} className="mt-2 w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
