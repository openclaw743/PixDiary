import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import UploadPage from '@/pages/Upload';
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

vi.mock('@/lib/blobUpload', async () => {
  return {
    uploadToBlob: vi.fn(async () => undefined),
    BlobUploadError: class BlobUploadError extends Error {
      status = 0;
    },
  };
});

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
});

function renderUpload(initial = '/upload') {
  vi.setSystemTime(new Date('2026-05-08T10:00:00Z'));
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider skipBootstrap>
        <Routes>
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/entries/:id" element={<div>Entry page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function makeFile(name: string, type: string, size = 1024): File {
  const f = new File([new Uint8Array(16)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('UploadPage', () => {
  it('renders the drop zone as a button with descriptive label', () => {
    renderUpload();
    const dz = screen.getByRole('button', { name: /upload photos/i });
    expect(dz).toBeInTheDocument();
    expect(dz.tagName).toBe('BUTTON');
  });

  it('rejects unsupported mime types with a specific error message', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderUpload();
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const f = makeFile('a.gif', 'image/gif', 100);
    Object.defineProperty(input, 'files', { value: [f] });
    fireEvent.change(input);
    expect(await screen.findByText(/not supported/i)).toBeInTheDocument();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('runs the full happy path: SAS request → blob upload → draft → navigate', async () => {
    apiMock.post.mockImplementation((path: string) => {
      if (path === '/uploads') {
        return Promise.resolve({
          items: [
            {
              photoId: 'p-1',
              sasUrl: 'https://blob/sas-1',
              blobPath: 'u/d/p-1.jpg',
              expiresAt: '2026-05-08T11:00:00Z',
            },
          ],
        });
      }
      if (path === '/entries/draft') {
        return Promise.resolve({ entryId: 'e-1', status: 'processing' });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    const user = userEvent.setup();
    renderUpload();
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    await user.upload(input, makeFile('a.jpg', 'image/jpeg', 5000));

    await waitFor(() => {
      expect(apiMock.post).toHaveBeenCalledWith(
        '/uploads',
        expect.objectContaining({
          entryDate: expect.any(String),
          items: [
            expect.objectContaining({ filename: 'a.jpg', mimeType: 'image/jpeg' }),
          ],
        }),
        expect.anything(),
      );
    });
    expect(await screen.findByText(/entry page/i)).toBeInTheDocument();
  });

  it('shows the quota-blocked banner when /uploads returns 422', async () => {
    const { ApiError } = await import('@/api/client');
    apiMock.post.mockRejectedValueOnce(
      new ApiError(422, { code: 'quota_exceeded', message: 'no' }),
    );
    const user = userEvent.setup();
    renderUpload();
    await user.upload(
      screen.getByTestId('file-input') as HTMLInputElement,
      makeFile('a.jpg', 'image/jpeg', 1000),
    );
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/daily ai quota reached/i);
  });

  it('uses the date from ?date= when provided', () => {
    renderUpload('/upload?date=2026-05-01');
    expect(
      screen.getByRole('heading', { level: 1 }),
    ).toHaveTextContent(/May 1/);
  });

  it('responds to drag-over with a visible "Drop to upload" cue', async () => {
    const { fireEvent } = await import('@testing-library/react');
    renderUpload();
    const dz = screen.getByRole('button', { name: /upload photos/i });
    fireEvent.dragOver(dz);
    // "Drop to upload" appears both in the visible UI and the aria-live region.
    const matches = await screen.findAllByText(/drop to upload/i);
    expect(matches.length).toBeGreaterThan(0);
    fireEvent.dragLeave(dz);
  });

  it('uploads files dropped on the drop zone', async () => {
    apiMock.post.mockImplementation((path: string) => {
      if (path === '/uploads') {
        return Promise.resolve({
          items: [
            { photoId: 'p-1', sasUrl: 'https://blob/sas-1', blobPath: 'b', expiresAt: 'x' },
          ],
        });
      }
      if (path === '/entries/draft') {
        return Promise.resolve({ entryId: 'e-9', status: 'processing' });
      }
      return Promise.reject(new Error('boom'));
    });
    const { fireEvent } = await import('@testing-library/react');
    renderUpload();
    const dz = screen.getByRole('button', { name: /upload photos/i });
    const file = makeFile('drop.jpg', 'image/jpeg', 1234);
    fireEvent.drop(dz, { dataTransfer: { files: [file] } });
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/uploads',
        expect.objectContaining({ items: [expect.objectContaining({ filename: 'drop.jpg' })] }),
        expect.anything(),
      ),
    );
  });

  it('shows the quota banner when /entries/draft returns 422', async () => {
    const { ApiError } = await import('@/api/client');
    apiMock.post.mockImplementation((path: string) => {
      if (path === '/uploads') {
        return Promise.resolve({
          items: [
            { photoId: 'p-1', sasUrl: 'https://blob/sas-1', blobPath: 'b', expiresAt: 'x' },
          ],
        });
      }
      if (path === '/entries/draft') {
        return Promise.reject(
          new ApiError(422, { code: 'quota_exceeded', message: 'no' }),
        );
      }
      return Promise.reject(new Error('boom'));
    });
    const user = userEvent.setup();
    renderUpload();
    await user.upload(
      screen.getByTestId('file-input') as HTMLInputElement,
      makeFile('a.jpg', 'image/jpeg', 1000),
    );
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/daily ai quota reached/i);
  });
});
