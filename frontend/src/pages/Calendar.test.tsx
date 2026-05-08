import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import CalendarPage from '@/pages/Calendar';
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

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
  // /entries (month + recent) — both calls return arrays
  apiMock.get.mockImplementation((path: string) => {
    if (path.startsWith('/entries')) {
      return Promise.resolve({
        items: [
          {
            id: 'e-may-8',
            entryDate: '2026-05-08',
            status: 'saved',
            thumbnailUrl: null,
            excerpt: 'Slept in. Walked to Vesterbro for a flat white at the corner café.',
            placeName: 'Café Nero, Vesterbro',
            photoCount: 5,
          },
        ],
        nextCursor: null,
      });
    }
    return Promise.resolve(null);
  });
});

function renderCalendar() {
  vi.setSystemTime(new Date('2026-05-08T10:00:00Z'));
  return render(
    <MemoryRouter initialEntries={['/calendar']}>
      <AuthProvider skipBootstrap>
        <Routes>
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/entries/:id" element={<div>Entry page</div>} />
          <Route path="/upload" element={<div>Upload page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('CalendarPage', () => {
  it('renders the month grid as a role="grid" with weekday <th> and tile buttons', async () => {
    renderCalendar();
    expect(await screen.findByRole('grid')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Mon/ })).toBeInTheDocument();
    // 31 buttons for May 2026, plus nav buttons; just check at least one labelled tile.
    expect(
      await screen.findByRole('button', { name: /May 8.*entry/i }),
    ).toBeInTheDocument();
  });

  it('marks today with aria-current="date" and disables future days', async () => {
    renderCalendar();
    const today = await screen.findByRole('button', { name: /Today, .*May 8/i });
    expect(today).toHaveAttribute('aria-current', 'date');
    const future = screen.getByRole('button', { name: /May 9.*future/i });
    expect(future).toBeDisabled();
    expect(future).toHaveAttribute('aria-disabled', 'true');
  });

  it('navigates to the entry on tile click when an entry exists', async () => {
    const user = userEvent.setup();
    renderCalendar();
    const tile = await screen.findByRole('button', { name: /May 8.*entry/i });
    await user.click(tile);
    expect(await screen.findByText(/entry page/i)).toBeInTheDocument();
  });

  it('navigates to /upload?date=… when clicking an empty past day', async () => {
    const user = userEvent.setup();
    renderCalendar();
    const empty = await screen.findByRole('button', { name: /^Friday, May 1$/ });
    await user.click(empty);
    expect(await screen.findByText(/upload page/i)).toBeInTheDocument();
  });

  it('shows the Recent list with the entry excerpt', async () => {
    renderCalendar();
    const nav = await screen.findByRole('navigation', { name: /recent entries/i });
    expect(nav).toHaveTextContent(/Café Nero/);
    expect(nav).toHaveTextContent(/Slept in/);
  });

  it('moves the focused day with ArrowRight (keyboard nav)', async () => {
    const user = userEvent.setup();
    renderCalendar();
    const today = await screen.findByRole('button', { name: /Today, .*May 8/i });
    today.focus();
    await user.keyboard('{ArrowRight}');
    // May 9 is future / disabled — focus may or may not move (browsers skip
    // disabled buttons on Tab, but focus() works). Check May 9 has tabIndex 0
    // (logical focus) at minimum by inspecting the button DOM.
    await waitFor(() => {
      const may9 = screen.getByRole('button', { name: /May 9.*future/i });
      expect(may9).toHaveAttribute('tabindex', '0');
    });
  });
});
