/**
 * Reverse-geocode service.
 *
 * Uses Azure Maps Search Address Reverse API. Cached in `locations` keyed by
 * lat/lng rounded to 4 decimals (~11m).
 *
 * If `AZURE_MAPS_KEY` is not configured the service returns null and logs a
 * warning — diary draft can proceed without place name.
 */
import type { Pool } from 'pg';
import { getConfig } from '../config';
import { getLogger } from '../log';
import { getPool } from '../db/pool';
import { roundCoord } from './exif';

export interface GeoResult {
  /** Pretty multi-part name: "Café Nero, Vesterbro, Copenhagen" or just a city. */
  placeName: string;
  country: string | null;
  region: string | null;
  /** Database `locations.id` once persisted (null if not stored). */
  locationId: string | null;
}

interface ServiceDeps {
  pool?: Pool;
  /** Override the network call (test-injectable). */
  fetcher?: typeof fetch;
}

function poolOf(deps?: ServiceDeps): Pool {
  return deps?.pool ?? getPool();
}

interface AzureMapsAddress {
  freeformAddress?: string;
  municipality?: string;
  municipalitySubdivision?: string;
  countrySubdivision?: string;
  country?: string;
  countryCode?: string;
}

interface AzureMapsResponse {
  addresses?: Array<{ address?: AzureMapsAddress }>;
}

function bestPlaceName(addr: AzureMapsAddress): string {
  const parts: string[] = [];
  if (addr.municipalitySubdivision && addr.municipalitySubdivision !== addr.municipality) {
    parts.push(addr.municipalitySubdivision);
  }
  if (addr.municipality) parts.push(addr.municipality);
  if (parts.length === 0 && addr.freeformAddress) return addr.freeformAddress;
  if (parts.length === 0 && addr.country) return addr.country;
  return parts.join(', ');
}

/**
 * Look up a cached entry; null if not cached.
 */
async function lookupCache(
  pool: Pool,
  lat4dp: number,
  lng4dp: number,
): Promise<GeoResult | null> {
  const r = await pool.query<{
    id: string;
    place_name: string;
    country: string | null;
    region: string | null;
  }>(
    `SELECT id, place_name, country, region
     FROM locations WHERE lat_4dp = $1 AND lng_4dp = $2`,
    [lat4dp, lng4dp],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    placeName: row.place_name,
    country: row.country,
    region: row.region,
    locationId: row.id,
  };
}

async function persistCache(
  pool: Pool,
  lat4dp: number,
  lng4dp: number,
  res: Omit<GeoResult, 'locationId'>,
  raw: unknown,
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO locations (lat_4dp, lng_4dp, place_name, country, region, raw)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (lat_4dp, lng_4dp)
     DO UPDATE SET place_name = EXCLUDED.place_name,
                   country    = EXCLUDED.country,
                   region     = EXCLUDED.region,
                   raw        = EXCLUDED.raw,
                   cached_at  = now()
     RETURNING id`,
    [lat4dp, lng4dp, res.placeName, res.country, res.region, JSON.stringify(raw)],
  );
  return r.rows[0]!.id;
}

/**
 * Reverse-geocode a (lat, lng) pair. Returns the cached row if present;
 * otherwise calls Azure Maps and caches the result.
 *
 * Returns null on any failure (logged but not thrown — the diary draft
 * proceeds without a place name).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  deps?: ServiceDeps,
): Promise<GeoResult | null> {
  const log = getLogger();
  const cfg = getConfig();
  const pool = poolOf(deps);
  const lat4dp = roundCoord(lat);
  const lng4dp = roundCoord(lng);

  // Cache hit short-circuit.
  const cached = await lookupCache(pool, lat4dp, lng4dp).catch(() => null);
  if (cached) return cached;

  if (cfg.AI_DISABLED || !cfg.AZURE_MAPS_KEY) {
    log.warn('geocode_skipped_no_key');
    return null;
  }

  const fetcher = deps?.fetcher ?? fetch;
  const url = new URL('https://atlas.microsoft.com/search/address/reverse/json');
  url.searchParams.set('api-version', '1.0');
  url.searchParams.set('subscription-key', cfg.AZURE_MAPS_KEY);
  url.searchParams.set('query', `${lat4dp},${lng4dp}`);
  url.searchParams.set('language', 'en-US');

  let raw: AzureMapsResponse;
  try {
    const res = await fetcher(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      log.warn({ status: res.status }, 'geocode_request_failed');
      return null;
    }
    raw = (await res.json()) as AzureMapsResponse;
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'geocode_request_error');
    return null;
  }

  const first = raw.addresses?.[0]?.address;
  if (!first) {
    log.warn('geocode_empty_result');
    return null;
  }
  const result: Omit<GeoResult, 'locationId'> = {
    placeName: bestPlaceName(first),
    country: first.country ?? null,
    region: first.countrySubdivision ?? null,
  };
  if (!result.placeName) return null;

  let locationId: string | null = null;
  try {
    locationId = await persistCache(pool, lat4dp, lng4dp, result, raw);
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'geocode_cache_persist_failed');
  }
  return { ...result, locationId };
}
