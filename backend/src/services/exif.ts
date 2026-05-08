/**
 * EXIF extraction service.
 *
 * Extracts dateTaken, GPS, and camera info from a photo buffer using `exifr`
 * (no native deps). Returns plain values; never returns the original EXIF.
 *
 * IMPORTANT: GPS coordinates returned here are kept server-side only — they
 * MUST NOT be exposed in any user-facing response. Use the `locations` cache
 * (place names) for that.
 */
import exifr from 'exifr';

export interface ExifData {
  /** EXIF DateTimeOriginal → DateTime → null */
  takenAt: Date | null;
  /** Decimal degrees, signed. Null if absent. */
  gpsLat: number | null;
  /** Decimal degrees, signed. Null if absent. */
  gpsLng: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  /** Pixel width (from EXIF). null if absent. */
  width: number | null;
  /** Pixel height (from EXIF). null if absent. */
  height: number | null;
}

interface RawExif {
  DateTimeOriginal?: Date | string | null;
  CreateDate?: Date | string | null;
  DateTime?: Date | string | null;
  ModifyDate?: Date | string | null;
  latitude?: number | null;
  longitude?: number | null;
  Make?: string | null;
  Model?: string | null;
  ExifImageWidth?: number | null;
  ExifImageHeight?: number | null;
  ImageWidth?: number | null;
  ImageHeight?: number | null;
  PixelXDimension?: number | null;
  PixelYDimension?: number | null;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

function toCleanString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extract a normalized ExifData from a photo buffer.
 * Returns all-null fields if EXIF is missing or malformed (never throws).
 */
export async function extractExif(buf: Buffer): Promise<ExifData> {
  const empty: ExifData = {
    takenAt: null,
    gpsLat: null,
    gpsLng: null,
    cameraMake: null,
    cameraModel: null,
    width: null,
    height: null,
  };

  let raw: RawExif | null = null;
  try {
    const opts = {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      reviveValues: true,
      // Returns latitude/longitude as decimal-degree numbers.
      translateValues: true,
      mergeOutput: true,
    } as unknown as Parameters<typeof exifr.parse>[1];
    raw = (await exifr.parse(buf, opts)) as RawExif | null;
  } catch {
    return empty;
  }

  if (!raw || typeof raw !== 'object') return empty;

  const takenAt =
    toDate(raw.DateTimeOriginal) ??
    toDate(raw.CreateDate) ??
    toDate(raw.DateTime) ??
    toDate(raw.ModifyDate);

  const gpsLat = toFiniteNumber(raw.latitude);
  const gpsLng = toFiniteNumber(raw.longitude);

  const validGps =
    gpsLat !== null &&
    gpsLng !== null &&
    Math.abs(gpsLat) <= 90 &&
    Math.abs(gpsLng) <= 180 &&
    !(gpsLat === 0 && gpsLng === 0); // ignore the all-zero placeholder common in stripped exifs

  return {
    takenAt,
    gpsLat: validGps ? gpsLat : null,
    gpsLng: validGps ? gpsLng : null,
    cameraMake: toCleanString(raw.Make),
    cameraModel: toCleanString(raw.Model),
    width:
      toFiniteNumber(raw.ExifImageWidth) ??
      toFiniteNumber(raw.PixelXDimension) ??
      toFiniteNumber(raw.ImageWidth),
    height:
      toFiniteNumber(raw.ExifImageHeight) ??
      toFiniteNumber(raw.PixelYDimension) ??
      toFiniteNumber(raw.ImageHeight),
  };
}

/**
 * Round lat/lng to 4 decimals (~11m). Used as the geocode cache key.
 * Returns null if either input is null.
 */
export function roundCoord(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
