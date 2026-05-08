import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ToastProvider, useToast } from '@/components/Toast';

function Trigger() {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() => show({ message: 'Deleted.', action: { label: 'Undo', onAction: () => undefined } })}
    >
      fire
    </button>
  );
}

function FastTrigger() {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() => show({ message: 'gone soon', durationMs: 100 })}
    >
      fire
    </button>
  );
}

describe('Toast', () => {
  it('shows a toast with action button and dismisses on action click', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: /fire/i }));
    expect(await screen.findByText(/deleted/i)).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: /undo/i });
    await user.click(undo);
    expect(screen.queryByText(/deleted/i)).toBeNull();
  });

  it('auto-dismisses after the duration', async () => {
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <FastTrigger />
        </ToastProvider>,
      );
      const fireBtn = screen.getByRole('button', { name: /fire/i });
      await act(async () => {
        fireBtn.click();
      });
      expect(screen.getByText(/gone soon/i)).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.queryByText(/gone soon/i)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
