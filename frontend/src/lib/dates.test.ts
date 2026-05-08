import { describe, expect, it } from 'vitest';

import {
  formatLongDate,
  formatMonthYear,
  formatShortTime,
  mondayFirstWeekday,
  parseIsoDate,
  toIsoDate,
} from '@/lib/dates';

describe('toIsoDate', () => {
  it('formats a date as YYYY-MM-DD', () => {
    const d = new Date(Date.UTC(2026, 4, 8, 12, 0, 0));
    expect(toIsoDate(d, 'UTC')).toBe('2026-05-08');
  });
});

describe('formatLongDate', () => {
  it('formats with weekday and month', () => {
    expect(formatLongDate('2026-05-08', { withYear: true })).toMatch(/2026/);
    expect(formatLongDate('2026-05-08')).toMatch(/May 8/);
  });
});

describe('formatMonthYear', () => {
  it('formats month + year', () => {
    expect(formatMonthYear(2026, 4)).toBe('May 2026');
  });
});

describe('formatShortTime', () => {
  it('formats HH:MM', () => {
    expect(formatShortTime('2026-05-08T14:23:00Z', 'UTC')).toBe('14:23');
  });
});

describe('parseIsoDate', () => {
  it('parses with local noon to avoid DST shifts', () => {
    const d = parseIsoDate('2026-05-08');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4);
    expect(d.getDate()).toBe(8);
    expect(d.getHours()).toBe(12);
  });
});

describe('mondayFirstWeekday', () => {
  it('maps Sunday=0..Saturday=6 to Monday=0..Sunday=6', () => {
    // Sunday → 6
    expect(mondayFirstWeekday(0)).toBe(6);
    // Monday → 0
    expect(mondayFirstWeekday(1)).toBe(0);
    // Saturday → 5
    expect(mondayFirstWeekday(6)).toBe(5);
  });
});
