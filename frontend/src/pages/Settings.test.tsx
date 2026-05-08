import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import SettingsPage from '@/pages/Settings';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/Toast';
import { ApiError } from '@/api/client';

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

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
});

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <AuthProvider skipBootstrap>
        <ToastProvider>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/login" element={<div>Login page</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('SettingsPage', () => {
  it('loads timezone + cap and renders the slider in [€0.10, €5.00]', async () => {
    apiMock.get.mockResolvedValueOnce({
      timezone: 'Europe/Copenhagen',
      dailyCapEur: 0.5,
    });
    renderSettings();
    await waitFor(() =>
      expect(screen.getByLabelText(/timezone/i)).toHaveValue('Europe/Copenhagen'),
    );
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('min', '0.1');
    expect(slider).toHaveAttribute('max', '5');
    expect(slider).toHaveValue('0.5');
  });

  it('saves preferences via PUT /settings', async () => {
    apiMock.get.mockResolvedValueOnce({
      timezone: 'UTC',
      dailyCapEur: 0.5,
    });
    apiMock.put.mockResolvedValueOnce({ timezone: 'UTC', dailyCapEur: 1.0 });
    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText(/timezone/i);
    const slider = screen.getByRole('slider');
    await user.click(slider);
    // Move slider via keyboard
    await user.keyboard('{ArrowRight>20/}');
    await user.click(screen.getByRole('button', { name: /save preferences/i }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
    const [url, body] = apiMock.put.mock.calls[0];
    expect(url).toBe('/settings');
    expect(body).toEqual(
      expect.objectContaining({ timezone: 'UTC', dailyCapEur: expect.any(Number) }),
    );
  });

  it('rejects delete-account with the wrong confirm phrase before calling the API', async () => {
    apiMock.get.mockResolvedValueOnce({ timezone: 'UTC', dailyCapEur: 0.5 });
    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText(/timezone/i);
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22hunter');
    await user.type(screen.getByLabelText(/type "DELETE MY ACCOUNT"/i), 'delete me');
    // Button stays disabled when confirm phrase is wrong → click is a no-op.
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeDisabled();
    expect(apiMock.delete).not.toHaveBeenCalled();
  });

  it('deletes the account when phrase matches exactly and password is given', async () => {
    apiMock.get.mockResolvedValueOnce({ timezone: 'UTC', dailyCapEur: 0.5 });
    apiMock.delete.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText(/timezone/i);
    await user.type(screen.getByLabelText(/^password$/i), 'hunter22hunter');
    await user.type(
      screen.getByLabelText(/type "DELETE MY ACCOUNT"/i),
      'DELETE MY ACCOUNT',
    );
    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    await waitFor(() =>
      expect(apiMock.delete).toHaveBeenCalledWith(
        '/account',
        expect.objectContaining({
          body: { password: 'hunter22hunter', confirmation: 'DELETE MY ACCOUNT' },
        }),
      ),
    );
  });

  it('reports an inline error on 401 from delete-account without logging out', async () => {
    apiMock.get.mockResolvedValueOnce({ timezone: 'UTC', dailyCapEur: 0.5 });
    apiMock.delete.mockRejectedValueOnce(
      new ApiError(401, { code: 'invalid_credentials', message: 'no' }),
    );
    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText(/timezone/i);
    await user.type(screen.getByLabelText(/^password$/i), 'wrongpasswrd');
    await user.type(
      screen.getByLabelText(/type "DELETE MY ACCOUNT"/i),
      'DELETE MY ACCOUNT',
    );
    await user.click(screen.getByRole('button', { name: /delete my account/i }));
    expect(await screen.findByText(/password did not match/i)).toBeInTheDocument();
  });

  it('exports the diary as a JSON file (creates a download link)', async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/settings') return Promise.resolve({ timezone: 'UTC', dailyCapEur: 0.5 });
      if (path === '/export')
        return Promise.resolve({
          exportedAt: '2026-05-08T10:00:00Z',
          user: {
            id: 'u-1',
            email: 'a@b.c',
            timezone: 'UTC',
            dailyCapEur: 0.5,
            createdAt: '2026-01-01T00:00:00Z',
          },
          entries: [],
        });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    // Stub URL.createObjectURL/revokeObjectURL for jsdom.
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = createObjectURL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = revokeObjectURL;

    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText(/timezone/i);
    await user.click(screen.getByRole('button', { name: /download export/i }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalled());
    expect(await screen.findByText(/export downloaded/i)).toBeInTheDocument();
  });
});
