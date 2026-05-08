import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  MAX_BATCH_SIZE,
  MAX_FILE_BYTES,
  runWithConcurrency,
  validateFiles,
} from '@/lib/uploads';

function fakeFile(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(Math.min(size, 16))], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateFiles', () => {
  it('rejects empty selections', () => {
    const res = validateFiles([]);
    expect(res.accepted).toHaveLength(0);
    expect(res.errors[0].message).toMatch(/no files/i);
  });

  it('accepts JPEG/PNG/HEIC/WebP under 25 MB', () => {
    const files = [
      fakeFile('a.jpg', 'image/jpeg', 1024),
      fakeFile('b.png', 'image/png', 1024),
      fakeFile('c.heic', 'image/heic', 1024),
      fakeFile('d.webp', 'image/webp', 1024),
    ];
    const { accepted, errors } = validateFiles(files);
    expect(accepted).toHaveLength(4);
    expect(errors).toHaveLength(0);
  });

  it('rejects unsupported mime types per file', () => {
    const files = [
      fakeFile('a.jpg', 'image/jpeg', 100),
      fakeFile('b.gif', 'image/gif', 100),
    ];
    const { accepted, errors } = validateFiles(files);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].name).toBe('a.jpg');
    expect(errors[0].filename).toBe('b.gif');
    expect(errors[0].message).toMatch(/not supported/i);
  });

  it('rejects oversized files (>25 MB)', () => {
    const big = fakeFile('big.jpg', 'image/jpeg', MAX_FILE_BYTES + 1);
    const { accepted, errors } = validateFiles([big]);
    expect(accepted).toHaveLength(0);
    expect(errors[0].message).toMatch(/max is/i);
  });

  it('rejects empty (0-byte) files', () => {
    const empty = fakeFile('empty.jpg', 'image/jpeg', 0);
    const { accepted, errors } = validateFiles([empty]);
    expect(accepted).toHaveLength(0);
    expect(errors[0].message).toMatch(/is empty/i);
  });

  it('flags batches over the per-batch maximum and trims to the cap', () => {
    const tooMany = Array.from({ length: MAX_BATCH_SIZE + 3 }, (_, i) =>
      fakeFile(`p${i}.jpg`, 'image/jpeg', 100),
    );
    const { accepted, errors } = validateFiles(tooMany);
    expect(accepted.length).toBe(MAX_BATCH_SIZE);
    expect(errors.some((e) => /at most/i.test(e.message))).toBe(true);
  });
});

describe('runWithConcurrency', () => {
  it('runs at most `limit` tasks at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, () => async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return 'ok';
    });
    const results = await runWithConcurrency(tasks, 3);
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('returns rejected outcomes without aborting siblings', async () => {
    const tasks = [
      async () => 'a',
      async () => {
        throw new Error('boom');
      },
      async () => 'c',
    ];
    const results = await runWithConcurrency(tasks, 2);
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'a' });
    expect(results[1].status).toBe('rejected');
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'c' });
  });
});

describe('formatBytes', () => {
  it('formats bytes/KB/MB ranges', () => {
    expect(formatBytes(800)).toBe('800 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
