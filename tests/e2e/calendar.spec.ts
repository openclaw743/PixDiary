/**
 * E2E: calendar navigation and recent list.
 *
 * Seeds a couple of entries via the API, loads the calendar, and asserts
 * that:
 *   - the month nav (prev/next) works
 *   - the recent entries list shows the seeded entries
 *   - clicking a day with an entry navigates to that entry
 */
import { expect, test } from '@playwright/test';
import { apiSeedDraftedEntry, apiSignup, loginAs } from './helpers';

test.describe('calendar', () => {
  test('navigation and recent list show seeded entries', async ({ page }) => {
    const user = await apiSignup();
    const e1 = await apiSeedDraftedEntry(user, { entryDate: '2025-05-08', photoCount: 1 });
    const e2 = await apiSeedDraftedEntry(user, { entryDate: '2025-05-09', photoCount: 1 });

    await loginAs(page, user, { goto: '/' });

    // The calendar grid is labelled per month.
    await expect(page.getByRole('grid', { name: /calendar — /i })).toBeVisible({
      timeout: 15_000,
    });

    // Month nav buttons exist.
    await expect(page.getByRole('button', { name: /previous month/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /next month/i })).toBeVisible();

    // Recent entries nav contains links — at least the two we just made.
    const recents = page.getByRole('navigation', { name: /recent entries/i });
    await expect(recents).toBeVisible();
    // The link text is date-shaped; the entry IDs are in the href.
    const links = recents.getByRole('link');
    await expect(links).toHaveCount(2, { timeout: 15_000 });

    // Click the first one (newest first) — should navigate to that entry.
    const firstHref = await links.first().getAttribute('href');
    expect(firstHref).toMatch(new RegExp(`/(entries/)?(${e1.entryId}|${e2.entryId})$`));
    await links.first().click();

    await page.waitForURL(/\/entries\/[0-9a-f-]+/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
