/**
 * Unit tests for reverseGeocode. No network calls; pool + fetcher are stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { resetConfigCache } from '../config';
import { reverseGeocode } from './geocode';

function setEnv(overrides: Record<string, string | undefined> = {}): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgres://localhost:5432/pixdiary';
  process.env.JWT_SECRET = 'geocode-secret-geocode-secret-geocode-secret';
  process.env.LOG_LEVEL = 'silent';
  delete process.env.AZURE_MAPS_KEY;
  delete process.env.AI_DISABLED;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfigCache();
}

interface FakePoolOpts {
  cachedRow?: { id: string; place_name: string; country: string | null; region: string | null };
  insertId?: string;
  failCacheLookup?: boolean;
  failPersist?: boolean;
}

function makeFakePool(opts: FakePoolOpts = {}): Pool {
  const calls: string[] = [];
  const pool = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM locations')) {
        if (opts.failCacheLookup) throw new Error('db down');
        return { rows: opts.cachedRow ? [opts.cachedRow] : [], rowCount: opts.cachedRow ? 1 : 0 };
      }
      if (sql.includes('INSERT INTO locations')) {
        if (opts.failPersist) throw new Error('insert failed');
        return { rows: [{ id: opts.insertId ?? 'loc-new' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };
  return pool as unknown as Pool;
}

describe('reverseGeocode', () => {
  beforeEach(() => setEnv());
  afterEach(() => setEnv());

  it('returns null when AZURE_MAPS_KEY is unset and no cache hit', async () => {
    setEnv({ AZURE_MAPS_KEY: undefined });
    const pool = makeFakePool();
    const r = await reverseGeocode(55.6761, 12.5683, { pool });
    expect(r).toBeNull();
  });

  it('serves cache hits without calling the network', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool({
      cachedRow: { id: 'loc-cached', place_name: 'Copenhagen', country: 'DK', region: null },
    });
    const fetcher = vi.fn();
    const r = await reverseGeocode(55.6761, 12.5683, {
      pool,
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(r).toEqual({
      placeName: 'Copenhagen',
      country: 'DK',
      region: null,
      locationId: 'loc-cached',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('falls through to fetcher on cache miss and persists', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool({ insertId: 'loc-fresh' });
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        addresses: [
          {
            address: {
              municipality: 'Copenhagen',
              municipalitySubdivision: 'Vesterbro',
              countrySubdivision: 'Capital Region',
              country: 'Denmark',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch;
    const r = await reverseGeocode(55.6761, 12.5683, { pool, fetcher });
    expect(r).toEqual({
      placeName: 'Vesterbro, Copenhagen',
      country: 'Denmark',
      region: 'Capital Region',
      locationId: 'loc-fresh',
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns null when fetcher returns non-ok', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool();
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const r = await reverseGeocode(40, -73, { pool, fetcher });
    expect(r).toBeNull();
  });

  it('returns null when fetcher throws', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool();
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const r = await reverseGeocode(40, -73, { pool, fetcher });
    expect(r).toBeNull();
  });

  it('returns null when Azure Maps returns no addresses', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool();
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ addresses: [] }),
    })) as unknown as typeof fetch;
    const r = await reverseGeocode(0, 0, { pool, fetcher });
    expect(r).toBeNull();
  });

  it('still returns a result when persisting cache fails', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool({ failPersist: true });
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        addresses: [{ address: { municipality: 'Paris', country: 'France' } }],
      }),
    })) as unknown as typeof fetch;
    const r = await reverseGeocode(48.8566, 2.3522, { pool, fetcher });
    expect(r?.placeName).toBe('Paris');
    expect(r?.locationId).toBeNull();
  });

  it('falls back to freeformAddress when no municipality is present', async () => {
    setEnv({ AZURE_MAPS_KEY: 'fake-key' });
    const pool = makeFakePool();
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        addresses: [{ address: { freeformAddress: 'Middle of nowhere', country: 'Antarctica' } }],
      }),
    })) as unknown as typeof fetch;
    const r = await reverseGeocode(-80, 0, { pool, fetcher });
    expect(r?.placeName).toBe('Middle of nowhere');
  });
});
