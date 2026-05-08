import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  // Clear token storage between tests so AuthContext starts fresh.
  if (typeof window !== 'undefined') {
    window.sessionStorage.clear();
    window.localStorage.clear();
  }
});
