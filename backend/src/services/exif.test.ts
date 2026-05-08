import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractExif, roundCoord } from './exif';

const FIXTURES = path.resolve(__dirname, '../../tests/fixtures');

describe('exif: extractExif', () => {
  it('extracts GPS, taken-at, camera, dimensions from a Pixel photo', async () => {
    const buf = readFileSync(path.join(FIXTURES, 'exif-gps-pixel.jpg'));
    const exif = await extractExif(buf);
    expect(exif.gpsLat).not.toBeNull();
    expect(exif.gpsLng).not.toBeNull();
    expect(exif.gpsLat!).toBeCloseTo(50.2996, 3);
    expect(exif.gpsLng!).toBeCloseTo(14.8203, 3);
    expect(exif.cameraMake).toBe('Google');
    expect(exif.cameraModel).toBe('Pixel');
    expect(exif.takenAt).toBeInstanceOf(Date);
    expect(exif.takenAt!.toISOString()).toContain('2018-07-25');
    expect(exif.width).toBe(4048);
    expect(exif.height).toBe(3036);
  });

  it('extracts taken-at and camera but no GPS from a 2003 Canon photo', async () => {
    const buf = readFileSync(path.join(FIXTURES, 'exif-canon-2003.jpg'));
    const exif = await extractExif(buf);
    expect(exif.gpsLat).toBeNull();
    expect(exif.gpsLng).toBeNull();
    expect(exif.cameraMake).toBe('Canon');
    expect(exif.cameraModel).toContain('PowerShot');
    expect(exif.takenAt).toBeInstanceOf(Date);
    expect(exif.takenAt!.toISOString()).toContain('2003');
  });

  it('returns all-null fields for non-EXIF buffers without throwing', async () => {
    const exif = await extractExif(Buffer.from('not a jpeg, just text'));
    expect(exif).toEqual({
      takenAt: null,
      gpsLat: null,
      gpsLng: null,
      cameraMake: null,
      cameraModel: null,
      width: null,
      height: null,
    });
  });

  it('returns all-null fields for empty buffer', async () => {
    const exif = await extractExif(Buffer.alloc(0));
    expect(exif.takenAt).toBeNull();
    expect(exif.gpsLat).toBeNull();
  });
});

describe('exif: roundCoord', () => {
  it('rounds to 4 decimals (banker-agnostic)', () => {
    expect(roundCoord(50.299602)).toBe(50.2996);
    expect(roundCoord(-14.82054999)).toBe(-14.8205);
    expect(roundCoord(0)).toBe(0);
  });
});
