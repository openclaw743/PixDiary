/**
 * Shared Playwright helpers — signup over the real API, then load the SPA
 * with the auth tokens already in localStorage. This keeps each spec focused
 * on the screen it cares about rather than re-running signup through the UI
 * every time.
 */
import type { Page } from '@playwright/test';

export const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://127.0.0.1:3000';

export interface TestUser {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
}

/**
 * Create a fresh user via the backend API. Returns the tokens so callers
 * can seed `localStorage` and skip the UI signup flow.
 */
export async function apiSignup(opts: { dailyCapEur?: number } = {}): Promise<TestUser> {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
  const password = 'a-good-password-1';
  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
  const u: TestUser = {
    email,
    password,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
  };
  if (opts.dailyCapEur !== undefined) {
    // /settings validation requires dailyCapEur >= 0.1.
    const cap = Math.max(0.1, opts.dailyCapEur);
    const put = await fetch(`${API_BASE}/settings`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${u.accessToken}`,
      },
      body: JSON.stringify({ dailyCapEur: cap }),
    });
    if (put.status !== 200) {
      throw new Error(`PUT /settings failed: ${put.status} ${await put.text()}`);
    }
  }
  return u;
}

/**
 * Visit the SPA root after seeding sessionStorage with the auth tokens.
 * Tokens live in sessionStorage per ARCHITECTURE.md (defense-in-depth: dies
 * with the tab). After this returns the user is "logged in" as far as the
 * app cares, and the Calendar screen should render.
 */
export async function loginAs(page: Page, user: TestUser, opts: { goto?: string } = {}): Promise<void> {
  await page.addInitScript(
    ({ access, refresh, baseUrl }: { access: string; refresh: string; baseUrl: string }) => {
      window.sessionStorage.setItem('pixdiary.accessToken', access);
      window.sessionStorage.setItem('pixdiary.refreshToken', refresh);
      // Some app code expects a pre-set API base; this is a no-op if the app
      // does its own discovery.
      (window as { __PIXDIARY_API_BASE__?: string }).__PIXDIARY_API_BASE__ = baseUrl;
    },
    { access: user.accessToken, refresh: user.refreshToken, baseUrl: API_BASE },
  );
  await page.goto(opts.goto ?? '/');
}

/**
 * Quickly seed a "drafted" entry through the API so the UI can be asserted
 * against without needing the AI pipeline to be live.
 *
 * Flow mirrors what the frontend does:
 *   1. POST /uploads to get N pre-signed SAS URLs.
 *   2. PUT a tiny JPEG payload to each SAS URL so the blob actually exists
 *      in Azurite (the entries route refuses to draft if any blob is
 *      missing).
 *   3. POST /entries/draft. AI_DISABLED=true short-circuits the
 *      orchestrator and writes a deterministic placeholder draft.
 */
export async function apiSeedDraftedEntry(
  user: TestUser,
  args: {
    entryDate: string;
    photoCount?: number;
  },
): Promise<{ entryId: string }> {
  // The smallest valid JPEG payload we ship as a fixture is 1x1 px (~600 B).
  const jpegBytes = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==',
    'base64',
  );

  // 1) Issue upload SAS for N photos.
  const items = Array.from({ length: args.photoCount ?? 1 }, (_, i) => ({
    filename: `e2e-${i}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: jpegBytes.length,
  }));
  const up = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user.accessToken}`,
    },
    body: JSON.stringify({ entryDate: args.entryDate, items }),
  });
  if (up.status !== 200) {
    throw new Error(`POST /uploads failed: ${up.status} ${await up.text()}`);
  }
  const upBody = (await up.json()) as {
    items: Array<{ photoId: string; sasUrl: string }>;
  };

  // 2) PUT bytes to each SAS URL.
  for (const it of upBody.items) {
    const put = await fetch(it.sasUrl, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'content-type': 'image/jpeg',
      },
      body: jpegBytes,
    });
    if (put.status !== 201 && put.status !== 200) {
      throw new Error(
        `blob PUT to SAS failed: ${put.status} ${await put.text()}`,
      );
    }
  }

  const photoIds = upBody.items.map((x) => x.photoId);

  // 3) Create the draft.
  const dr = await fetch(`${API_BASE}/entries/draft`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user.accessToken}`,
    },
    body: JSON.stringify({ entryDate: args.entryDate, photoIds }),
  });
  if (dr.status !== 202) {
    throw new Error(`POST /entries/draft failed: ${dr.status} ${await dr.text()}`);
  }
  const drBody = (await dr.json()) as { entryId: string };
  return { entryId: drBody.entryId };
}
