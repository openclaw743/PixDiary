/**
 * E2E: signup → login → logout.
 *
 * Runs against the real backend (signup via UI), then logs the same user
 * back in, asserts the calendar shell renders, and signs out.
 */
import { expect, test } from '@playwright/test';

test.describe('auth: signup → login → logout', () => {
  test('happy path through the UI', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 100_000)}@example.com`;
    const password = 'a-good-password-1';

    // ---- Signup ----
    await page.goto('/signup');
    // Heading is "Start your diary" (see frontend/src/components/AuthLayout.tsx + Signup.tsx).
    await expect(page.getByRole('heading', { name: /start your diary/i })).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel(/confirm/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // ---- Lands on Calendar (root) ----
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/calendar');
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();

    // ---- Sign out ----
    await page.getByRole('button', { name: /sign out/i }).click();

    // ---- Redirected to /login (RequireAuth kicks in on next nav) ----
    await page.waitForURL((url) => /\/login$/.test(url.pathname));
    await expect(page.getByRole('heading', { name: /welcome back|sign in/i })).toBeVisible();

    // ---- Log back in with same credentials ----
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/calendar');
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  });

  test('signup with mismatched confirm password shows inline error', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /start your diary/i })).toBeVisible();
    const email = `e2e-mm-${Date.now()}@example.com`;
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('a-good-password-1');
    await page.getByLabel(/confirm/i).fill('a-different-password-2');
    await page.getByRole('button', { name: /create account/i }).click();

    // The form should NOT navigate; an inline error appears.
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByText(/passwords? do not match|don.?t match/i)).toBeVisible();
  });

  test('login with bad credentials shows the sign-in failure banner', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('a-good-password-1');
    await page.getByRole('button', { name: /sign in/i }).click();

    // The Banner component renders title in a <p>, body in a <div>, with role="alert".
    const alert = page.getByRole('alert').filter({ hasText: /sign-?in failed/i });
    await expect(alert).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
