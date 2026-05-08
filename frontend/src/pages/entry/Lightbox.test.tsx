import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Lightbox } from '@/pages/entry/Lightbox';
import type { PhotoSummary } from '@/api/types';

const PHOTOS: PhotoSummary[] = [
  {
    id: 'p-1',
    readUrl: 'https://blob/photo1.jpg',
    readUrlExpiresAt: '2026-05-08T12:00:00Z',
    altText: 'A flat white on a wooden table',
  },
  {
    id: 'p-2',
    readUrl: 'https://blob/photo2.jpg',
    readUrlExpiresAt: '2026-05-08T12:00:00Z',
    altText: 'Cobblestone street at dawn',
  },
  {
    id: 'p-3',
    readUrl: 'https://blob/photo3.jpg',
    readUrlExpiresAt: '2026-05-08T12:00:00Z',
    altText: null,
  },
];

describe('Lightbox', () => {
  it('opens with correct alt text and photo counter', async () => {
    const onClose = vi.fn();
    const onIndexChange = vi.fn();
    render(
      <Lightbox photos={PHOTOS} index={0} onIndexChange={onIndexChange} onClose={onClose} />,
    );
    expect(screen.getByText(/photo 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      'A flat white on a wooden table',
    );
  });

  it('Next/Previous buttons advance the index', async () => {
    const onClose = vi.fn();
    const onIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Lightbox photos={PHOTOS} index={1} onIndexChange={onIndexChange} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: /next photo/i }));
    expect(onIndexChange).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole('button', { name: /previous photo/i }));
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('disables Previous on the first photo and Next on the last', () => {
    const onClose = vi.fn();
    const onIndexChange = vi.fn();
    const { rerender } = render(
      <Lightbox photos={PHOTOS} index={0} onIndexChange={onIndexChange} onClose={onClose} />,
    );
    expect(screen.getByRole('button', { name: /previous photo/i })).toBeDisabled();
    rerender(
      <Lightbox photos={PHOTOS} index={2} onIndexChange={onIndexChange} onClose={onClose} />,
    );
    expect(screen.getByRole('button', { name: /next photo/i })).toBeDisabled();
  });

  it('lets the user override the alt text per photo', async () => {
    const onClose = vi.fn();
    const onIndexChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Lightbox photos={PHOTOS} index={0} onIndexChange={onIndexChange} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: /edit description/i }));
    const ta = screen.getByLabelText(/photo description/i);
    await user.clear(ta);
    await user.type(ta, 'My custom description');
    await user.click(screen.getByRole('button', { name: /save description/i }));
    await waitFor(() =>
      expect(screen.getByRole('img')).toHaveAttribute('alt', 'My custom description'),
    );
  });

  it('cancels alt-text edit without saving', async () => {
    const user = userEvent.setup();
    render(
      <Lightbox
        photos={PHOTOS}
        index={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /edit description/i }));
    const ta = screen.getByLabelText(/photo description/i);
    await user.clear(ta);
    await user.type(ta, 'changed');
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    // Original alt remains
    expect(screen.getByRole('img')).toHaveAttribute(
      'alt',
      'A flat white on a wooden table',
    );
  });

  it('falls back to "Photo N of M" when no alt is provided', () => {
    render(
      <Lightbox
        photos={PHOTOS}
        index={2}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Photo 3 of 3');
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Lightbox
        photos={PHOTOS}
        index={0}
        onIndexChange={vi.fn()}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^close$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
