/**
 * E2E: quota UI surface.
 *
 * The full quota-blocked state can only be reached by actually exhausting
 * the daily cap through real AI calls, which we deliberately don't make in
 * E2E (no Azure OpenAI). What we DO lock down here is that the
 * quota-related UI surface renders correctly: the meter is visible on the
 * upload page for every user, fresh or not.
 *
 * The deeper backend behaviour (quota enforcement, refund, ledger math) is
 * covered by `backend/tests/integration/cost-ledger.test.ts`.
 */
import { expect, test } from '@playwright/test';
import { apiSignup, loginAs } from './helpers';

test.describe('quota UI', () => {
  test('upload page shows the daily AI quota meter for fresh users', async ({ page }) => {
    const user = await apiSignup();
    await loginAs(page, user, { goto: '/upload' });

    // The labelled progressbar/meter is the visible source-of-truth for
    // "how much of today's AI budget has been spent".
    await expect(page.getByLabel(/daily ai quota used/i)).toBeVisible({
      timeout: 15_000,
    });
  });
});
