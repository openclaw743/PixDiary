import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import SignupPage from '@/pages/Signup';
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
  return { ...actual, api: apiMock };
});

function renderSignup() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <AuthProvider skipBootstrap>
        <Routes>
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/" element={<div>Home page</div>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('SignupPage', () => {
  beforeEach(() => {
    apiMock.post.mockReset();
  });

  it('renders all three labelled fields and shows password rules up-front', () => {
    renderSignup();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    // Password rules visible up-front (not after-the-fact).
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
  });

  it('rejects passwords below the minimum length', async () => {
    const user = userEvent.setup();
    renderSignup();
    await user.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    await user.type(screen.getByLabelText(/confirm password/i), 'short');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('rejects mismatched confirm password', async () => {
    const user = userEvent.setup();
    renderSignup();
    await user.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password1234');
    await user.type(screen.getByLabelText(/confirm password/i), 'different1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('signs up successfully and navigates to /', async () => {
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
    renderSignup();
    await user.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password1234');
    await user.type(screen.getByLabelText(/confirm password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith('/auth/signup', {
        email: 'user@example.com',
        password: 'password1234',
      });
    });
    expect(await screen.findByText(/home page/i)).toBeInTheDocument();
  });

  it('shows a friendly conflict message on 409', async () => {
    apiMock.post.mockRejectedValueOnce(
      new ApiError(409, { code: 'email_taken', message: 'taken' }),
    );
    const user = userEvent.setup();
    renderSignup();
    await user.type(screen.getByLabelText(/^email$/i), 'user@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'password1234');
    await user.type(screen.getByLabelText(/confirm password/i), 'password1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
