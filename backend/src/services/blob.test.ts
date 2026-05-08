/**
 * Unit tests for blob path utilities + SAS issuance.
 *
 * SAS issuance is tested against Azurite (Docker). If Docker is unavailable
 * AND no `PIXDIARY_TEST_AZURITE_CONN_STRING` is set, those tests are skipped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { extForMime, getBlobBackend, makeBlobPath, setBlobBackend, SUPPORTED_MIME_TYPES } from './blob';
import { resetConfigCache } from '../config';

describe('blob path utilities', () => {
  it('maps each supported mime to a non-empty extension', () => {
    for (const m of SUPPORTED_MIME_TYPES) {
      expect(extForMime(m)).toBeTruthy();
    }
  });

  it('returns null for unsupported mime', () => {
    expect(extForMime('application/octet-stream')).toBeNull();
  });

  it('builds canonical <userId>/<date>/<photoId>.<ext> path', () => {
    const p = makeBlobPath(
      '11111111-1111-1111-1111-111111111111',
      '2026-05-08',
      '22222222-2222-2222-2222-222222222222',
      'image/jpeg',
    );
    expect(p).toBe(
      '11111111-1111-1111-1111-111111111111/2026-05-08/22222222-2222-2222-2222-222222222222.jpg',
    );
  });

  it('throws on unsupported mime', () => {
    expect(() => makeBlobPath('u', '2026-05-08', 'p', 'image/svg+xml')).toThrow(/unsupported/);
  });
});

/* ---------- Azurite-backed SAS tests ---------- */

interface TestAzurite {
  connStr: string;
  cleanup: () => Promise<void>;
}

function dockerAvailable(): boolean {
  if (process.env.PIXDIARY_TEST_AZURITE_CONN_STRING) return false;
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: 5_000,
  });
  return r.status === 0;
}

const AZURITE_DEFAULT_KEY =
  'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

async function startAzurite(): Promise<TestAzurite> {
  const name = `pixdiary-test-azurite-${randomUUID().slice(0, 8)}`;
  const port = 30000 + Math.floor(Math.random() * 20000);
  const args = [
    'run',
    '--rm',
    '-d',
    '--name',
    name,
    '-p',
    `${port}:10000`,
    'mcr.microsoft.com/azure-storage/azurite:3.33.0',
    'azurite-blob',
    '--blobHost',
    '0.0.0.0',
    '--skipApiVersionCheck',
  ];
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`docker run azurite failed: ${r.stderr}`);
  const connStr =
    `DefaultEndpointsProtocol=http;` +
    `AccountName=devstoreaccount1;` +
    `AccountKey=${AZURITE_DEFAULT_KEY};` +
    `BlobEndpoint=http://127.0.0.1:${port}/devstoreaccount1;`;
  // Wait until reachable.
  const deadline = Date.now() + 30_000;
  let ok = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/devstoreaccount1?comp=list&restype=service`,
      );
      if (res.status === 400 || res.status === 200 || res.status === 403) {
        ok = true;
        break;
      }
    } catch {
      // not ready
    }
    await delay(250);
  }
  if (!ok) {
    spawnSync('docker', ['rm', '-f', name]);
    throw new Error('Azurite did not become reachable');
  }
  const cleanup = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      const c = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
      c.on('exit', () => resolve());
      c.on('error', () => resolve());
    });
  };
  return { connStr, cleanup };
}

let azurite: TestAzurite | undefined;
const skip = !dockerAvailable() && !process.env.PIXDIARY_TEST_AZURITE_CONN_STRING;

beforeAll(async () => {
  if (skip) return;
  if (process.env.PIXDIARY_TEST_AZURITE_CONN_STRING) {
    azurite = {
      connStr: process.env.PIXDIARY_TEST_AZURITE_CONN_STRING,
      cleanup: async () => undefined,
    };
  } else {
    azurite = await startAzurite();
  }
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://x:y@localhost:5432/x';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret';
  process.env.AZURE_STORAGE_CONNECTION_STRING = azurite.connStr;
  process.env.AZURE_STORAGE_CONTAINER = `t${Date.now()}`;
  resetConfigCache();
  setBlobBackend(undefined);
}, 60_000);

afterAll(async () => {
  setBlobBackend(undefined);
  if (azurite) await azurite.cleanup();
}, 30_000);

describe.skipIf(skip)('blob: SAS issuance against Azurite', () => {
  it('issues a write SAS that allows uploading a small blob', async () => {
    const backend = getBlobBackend();
    const path = makeBlobPath(
      '11111111-1111-1111-1111-111111111111',
      '2026-05-08',
      '22222222-2222-2222-2222-222222222222',
      'image/jpeg',
    );
    const sas = await backend.issueUploadSas(path, 'image/jpeg');
    expect(sas.url).toContain('sig=');
    expect(sas.url).toContain('sp=cw');
    expect(sas.expiresAt.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    expect(sas.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 11 * 60_000);

    const body = Buffer.from('hello-pixdiary');
    const res = await fetch(sas.url, {
      method: 'PUT',
      headers: {
        'x-ms-blob-type': 'BlockBlob',
        'content-type': 'image/jpeg',
      },
      body,
    });
    expect(res.status).toBe(201);
    expect(await backend.exists(path)).toBe(true);

    const dl = await backend.download(path);
    expect(dl.toString('utf8')).toBe('hello-pixdiary');

    const read = await backend.issueReadSas(path);
    expect(read.url).toContain('sp=r');
    const got = await fetch(read.url);
    expect(got.status).toBe(200);

    await backend.remove(path);
    expect(await backend.exists(path)).toBe(false);
  }, 30_000);

  it('write SAS pins the content-type in the signed query', async () => {
    const backend = getBlobBackend();
    const path = makeBlobPath(
      '33333333-3333-3333-3333-333333333333',
      '2026-05-08',
      '44444444-4444-4444-4444-444444444444',
      'image/png',
    );
    const sas = await backend.issueUploadSas(path, 'image/png');
    const u = new URL(sas.url);
    expect(u.searchParams.get('rsct')).toBe('image/png');
    expect(u.searchParams.get('sp')).toBe('cw');
    expect(u.searchParams.get('sig')).toBeTruthy();
  });
});
