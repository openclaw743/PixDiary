import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import EntryPage from '@/pages/Entry';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/Toast';

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

const SAMPLE_ENTRY = {
  id: 'e-1',
  entryDate: '2026-05-08',
  status: 'drafted',
  draftText: 'Slept in. Walked to Vesterbro for a flat white.',
  finalText: null,
  photos: [
    {
      id: 'p-1',
      readUrl: 'https://blob/photo1.jpg',
      readUrlExpiresAt: '2026-05-08T12:00:00Z',
      altText: 'Flat white on a wooden table',
    },
    {
      id: 'p-2',
      readUrl: 'https://blob/photo2.jpg',
      readUrlExpiresAt: '2026-05-08T12:00:00Z',
      altText: 'Cobblestone street at dawn',
    },
  ],
  placeName: 'Café Nero, Vesterbro · Copenhagen',
  model: 'gpt-4o-mini',
  createdAt: '2026-05-08T14:23:00Z',
  lastEditedAt: null,
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
});

function renderEntry() {
  return render(
    <MemoryRouter initialEntries={['/entries/e-1']}>
      <AuthProvider skipBootstrap>
        <ToastProvider>
          <Routes>
            <Route path="/entries/:id" element={<EntryPage />} />
            <Route path="/calendar" element={<div>Calendar page</div>} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('EntryPage', () => {
  it('renders date as the single <h1>, place subtitle, and gallery thumbs as buttons', async () => {
    apiMock.get.mockResolvedValueOnce(SAMPLE_ENTRY);
    renderEntry();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/May 8.*2026/);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/Café Nero, Vesterbro/)).toBeInTheDocument();
    const thumbs = await screen.findAllByRole('button', { name: /Photo \d of 2/ });
    expect(thumbs).toHaveLength(2);
  });

  it('opens the lightbox on thumb click and closes on ESC, returning focus', async () => {
    apiMock.get.mockResolvedValue(SAMPLE_ENTRY);
    const user = userEvent.setup();
    renderEntry();
    const thumb = (await screen.findAllByRole('button', { name: /Photo 1 of 2/ }))[0];
    await user.click(thumb);
    // Headless UI dialog renders with role="dialog"
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(thumb).toHaveFocus());
  });

  it('enters edit mode and saves with Cmd/Ctrl+Enter', async () => {
    apiMock.get.mockResolvedValueOnce(SAMPLE_ENTRY);
    apiMock.put.mockResolvedValueOnce({
      ...SAMPLE_ENTRY,
      status: 'saved',
      finalText: 'Slept in. Walked to Vesterbro for a flat white. — edited',
      lastEditedAt: '2026-05-08T14:31:00Z',
    });

    const user = userEvent.setup();
    renderEntry();
    await screen.findByText(/Slept in/);
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const textarea = await screen.findByLabelText(/diary entry/i);
    await user.click(textarea);
    await user.keyboard(' more');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
    const [url, body] = apiMock.put.mock.calls[0];
    expect(url).toBe('/entries/e-1');
    expect((body as { text: string }).text).toMatch(/ more$/);
  });

  it('Esc cancels and asks confirmation when dirty', async () => {
    apiMock.get.mockResolvedValueOnce(SAMPLE_ENTRY);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderEntry();
    await screen.findByText(/Slept in/);
    await user.click(screen.getByRole('button', { name: /^edit$/i }));
    const textarea = await screen.findByLabelText(/diary entry/i);
    await user.click(textarea);
    await user.keyboard(' more');
    await user.keyboard('{Escape}');
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('soft-deletes and navigates to /calendar with toast undo', async () => {
    apiMock.get.mockResolvedValueOnce(SAMPLE_ENTRY);
    apiMock.delete.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderEntry();
    await screen.findByText(/Slept in/);
    // Open the More disclosure
    await user.click(screen.getByText(/More: Regenerate/i));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(apiMock.delete).toHaveBeenCalled());
    expect(await screen.findByText(/calendar page/i)).toBeInTheDocument();
  });

  it('shows the quota-blocked banner when entry status is quota_blocked', async () => {
    apiMock.get.mockResolvedValueOnce({ ...SAMPLE_ENTRY, status: 'quota_blocked' });
    renderEntry();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/daily ai quota reached/i);
  });
});
