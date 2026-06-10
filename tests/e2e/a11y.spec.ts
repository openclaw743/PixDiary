/**
 * E2E: a11y scan with axe-core on every authenticated screen.
 *
 * The acceptance criterion from issue #13 is "0 critical / ≤2 serious"
 * across every screen. We assert each route's main view passes that bar.
 *
 * Tags: only `wcag2a, wcag2aa, wcag21a, wcag21aa` are required.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiSeedDraftedEntry, apiSignup, loginAs } from './helpers';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function scan(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Exclude the focus-trap helpers introduced by Headless UI portals — they
    // are rendered but invisible; axe sometimes flags them as "elements must
    // have sufficient color contrast" with no real impact.
    .exclude('[data-headlessui-state]')
    .analyze();

  const critical = results.violations.filter((v) => v.impact === 'critical');
  const serious = results.violations.filter((v) => v.impact === 'serious');

  // Surface the violations in the failure message so the report explains
  // exactly what failed — including selectors.
  const dump = (
    list: typeof results.violations,
  ): string =>
    list
      .map(
        (v) =>
          `[${v.impact}] ${v.id} — ${v.help}\n` +
          `   nodes: ${v.nodes
            .slice(0, 3)
            .map((n) => n.target.join(' '))
            .join('; ')}`,
      )
      .join('\n');

  expect(
    critical,
    `[${label}] critical a11y violations:\n${dump(critical)}`,
  ).toEqual([]);
  expect(
    serious.length,
    `[${label}] serious a11y violations (≤2 allowed):\n${dump(serious)}`,
  ).toBeLessThanOrEqual(2);
}

test.describe('a11y: every screen passes axe-core', () => {
  test('login screen', async ({ page }) => {
    await page.goto('/login');
    await scan(page, 'login');
  });

  test('signup screen', async ({ page }) => {
    await page.goto('/signup');
    await scan(page, 'signup');
  });

  test('calendar (root)', async ({ page }) => {
    const user = await apiSignup();
    await loginAs(page, user, { goto: '/' });
    await page.getByRole('grid', { name: /calendar — /i }).waitFor({ timeout: 15_000 });
    await scan(page, 'calendar');
  });

  test('upload screen', async ({ page }) => {
    const user = await apiSignup();
    await loginAs(page, user, { goto: '/upload' });
    await page
      .getByRole('button', {
        name: /upload photos: drop files here or activate to browse/i,
      })
      .waitFor({ timeout: 15_000 });
    await scan(page, 'upload');
  });

  test('settings screen', async ({ page }) => {
    const user = await apiSignup();
    await loginAs(page, user, { goto: '/settings' });
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 15_000 });
    await scan(page, 'settings');
  });

  test('entry screen (drafted)', async ({ page }) => {
    const user = await apiSignup();
    const { entryId } = await apiSeedDraftedEntry(user, {
      entryDate: '2025-05-08',
      photoCount: 1,
    });
    await loginAs(page, user, { goto: `/entries/${entryId}` });
    await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 15_000 });
    await scan(page, 'entry');
  });
});
