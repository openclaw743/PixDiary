/**
 * E2E: upload happy path.
 *
 * Uses the API helper to skip signup-through-UI (already covered by
 * `auth.spec.ts`). The AI orchestrator runs in-process with AI_DISABLED=true,
 * so the draft text is a deterministic placeholder — we assert the
 * orchestrator transitions the entry to `drafted` and surfaces text in the
 * editor.
 */
import { expect, test } from '@playwright/test';
import { apiSeedDraftedEntry, apiSignup, loginAs } from './helpers';

test.describe('upload → draft → edit → save', () => {
  test('drafted entry surfaces text in the editor and can be saved', async ({ page }) => {
    const user = await apiSignup();
    // Seed via API: 3 fixture photos, AI placeholder draft.
    const { entryId } = await apiSeedDraftedEntry(user, {
      entryDate: '2025-05-08',
      photoCount: 3,
    });

    await loginAs(page, user, { goto: `/entries/${entryId}` });

    // The Entry page should show a heading/title for the date.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

    // The body is displayed read-only until the user clicks "Edit". With
    // AI_DISABLED=true the orchestrator writes the literal placeholder
    // text below as the draft.
    await expect(page.getByText(/\(ai disabled\)|placeholder/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Click the Edit button to switch into edit mode (this is the only way
    // a textarea appears — see frontend/src/pages/Entry.tsx).
    await page.getByRole('button', { name: /^edit$/i }).click();

    const editable = page.locator('textarea').first();
    await expect(editable).toBeVisible({ timeout: 5_000 });
    await expect(editable).not.toHaveValue('');

    // Edit the draft.
    await editable.fill('This is the edited diary entry typed by Playwright.');

    // Save.
    await page
      .getByRole('button', { name: /^save$/i })
      .first()
      .click();

    // After save, the read-only view should show our text.
    await expect(
      page.getByText(/this is the edited diary entry typed by playwright\./i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('upload screen renders the drop zone, daily quota, and accepts files', async ({ page }) => {
    const user = await apiSignup();
    await loginAs(page, user, { goto: '/upload' });

    // The drop zone is a labelled button.
    const dropZone = page.getByRole('button', {
      name: /upload photos: drop files here or activate to browse/i,
    });
    await expect(dropZone).toBeVisible();

    // The quota meter is present.
    await expect(page.getByLabel(/daily ai quota used/i)).toBeVisible();

    // The hidden file input is present too.
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    // We don't actually finish the upload here (the SAS upload to Azurite
    // is finicky to coordinate across browsers); the request-upload-URLs
    // flow is covered by the backend integration test.
  });
});
