import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import LoginPage from '@/pages/Login';
import { ApiError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthContext';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    api: apiMock,
  };
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider skipBootstrap>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/signup" element={<div>Signup page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
  });

  it('renders the form with labelled inputs (no placeholder-as-label)', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows inline validation errors for missing fields and focuses the first invalid one', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveFocus();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('rejects malformed emails before hitting the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('logs in successfully and navigates to /', async () => {
    apiMock.post.mockResolvedValueOnce({
      accessToken: 'a',
      refreshToken: 'r',
      user: {
        id: 'u-1',
        email: 'user@example.com',
        timezone: 'Europe/Copenhagen',
        dailyCapEur: 0.5,
        createdAt: '2026-05-08T00:00:00Z',
      },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/auth/login', {
        email: 'user@example.com',
        password: 'password1234',
      });
    });
    expect(await screen.findByText(/home page/i)).toBeInTheDocument();
  });

  it('shows a friendly error on 401 and keeps the form usable', async () => {
    apiMock.post.mockRejectedValueOnce(
      new ApiError(401, { code: 'invalid_credentials', message: 'no' }),
    );
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/did not match/i)).toBeInTheDocument();
    // Banner has role="alert"
    expect(screen.getByRole('alert')).toHaveTextContent(/did not match/i);
    // Submit button is enabled again so user can retry.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('handles network errors with a generic message', async () => {
    apiMock.post.mockRejectedValueOnce(new TypeError('network down'));
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();
  });
});
