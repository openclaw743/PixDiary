import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { listEntries } from '@/api/entries';
import type { EntrySummary } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { AppShell } from '@/components/AppShell';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import {
  formatLongDate,
  formatMonthYear,
  mondayFirstWeekday,
  toIsoDate,
} from '@/lib/dates';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface MonthInfo {
  /** Calendar year (e.g. 2026). */
  year: number;
  /** 0..11. */
  monthIndex: number;
  /** Number of leading blanks before day 1 (Mon-first). */
  leading: number;
  /** Days in this month. */
  daysInMonth: number;
}

function getMonthInfo(year: number, monthIndex: number): MonthInfo {
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  return {
    year,
    monthIndex,
    leading: mondayFirstWeekday(first.getDay()),
    daysInMonth: last.getDate(),
  };
}

/**
 * `/calendar` (and `/`) — month grid of past entries.
 *
 * Wireframe 03-calendar.md states A (default) and B (empty) plus the recent
 * list. Per accessibility.md:
 *   - <table role="grid"> with <th scope="col">.
 *   - Arrow keys move focus between days; Home/End within row; PgUp/PgDn switch months.
 *   - Today: aria-current="date".
 *   - Disabled future tiles: <button disabled aria-disabled="true">.
 *   - Cmd/Ctrl+T jumps to today.
 *   - Recent list is a <nav aria-label="Recent entries">.
 */
export default function CalendarPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = useMemo(() => toIsoDate(new Date(), user?.timezone), [user?.timezone]);
  const [todayY, todayM, todayD] = useMemo(
    () => today.split('-').map((s) => Number.parseInt(s, 10)),
    [today],
  );

  const [year, setYear] = useState<number>(todayY);
  const [monthIndex, setMonthIndex] = useState<number>(todayM - 1);
  const [focusedDay, setFocusedDay] = useState<number>(todayD);

  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [recent, setRecent] = useState<EntrySummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const tileRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());
  const pendingFocusRef = useRef<{ year: number; monthIndex: number; day: number } | null>(null);

  const monthInfo = useMemo(() => getMonthInfo(year, monthIndex), [year, monthIndex]);

  // Load month entries (overlapping +/- a day for boundary safety) and recent.
  useEffect(() => {
    let cancelled = false;
    const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    void (async () => {
      try {
        const [monthResp, recentResp] = await Promise.all([
          listEntries({ from, to, limit: 100 }),
          listEntries({ limit: 5 }),
        ]);
        if (cancelled) return;
        setEntries(monthResp.items);
        setRecent(recentResp.items);
        setLoadError(null);
      } catch {
        if (cancelled) return;
        setLoadError('Could not load entries. Please try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, monthIndex]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, EntrySummary>();
    for (const e of entries) map.set(e.entryDate, e);
    return map;
  }, [entries]);

  const isFuture = useCallback(
    (y: number, m: number, d: number): boolean => {
      const candidate = new Date(y, m, d).getTime();
      const todayDate = new Date(todayY, todayM - 1, todayD).getTime();
      return candidate > todayDate;
    },
    [todayY, todayM, todayD],
  );

  // Keep focus on the same logical day when month changes via keyboard nav.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (
      pending &&
      pending.year === year &&
      pending.monthIndex === monthIndex
    ) {
      const el = tileRefs.current.get(pending.day);
      el?.focus();
      pendingFocusRef.current = null;
    }
  }, [year, monthIndex]);

  // Cmd/Ctrl+T → today
  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        // Avoid hijacking new-tab outside the calendar — only when we have focus.
        if (document.activeElement && document.activeElement.closest('[data-calendar="true"]')) {
          e.preventDefault();
          setYear(todayY);
          setMonthIndex(todayM - 1);
          setFocusedDay(todayD);
          pendingFocusRef.current = { year: todayY, monthIndex: todayM - 1, day: todayD };
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [todayY, todayM, todayD]);

  function moveFocus(deltaDays: number): void {
    const date = new Date(year, monthIndex, focusedDay);
    date.setDate(date.getDate() + deltaDays);
    const ny = date.getFullYear();
    const nm = date.getMonth();
    const nd = date.getDate();
    if (ny !== year || nm !== monthIndex) {
      pendingFocusRef.current = { year: ny, monthIndex: nm, day: nd };
      setYear(ny);
      setMonthIndex(nm);
    } else {
      tileRefs.current.get(nd)?.focus();
    }
    setFocusedDay(nd);
  }

  function moveMonth(delta: number): void {
    const date = new Date(year, monthIndex + delta, 1);
    setYear(date.getFullYear());
    setMonthIndex(date.getMonth());
  }

  function activate(day: number): void {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isFuture(year, monthIndex, day)) return;
    const existing = entriesByDate.get(iso);
    if (existing) {
      navigate(`/entries/${existing.id}`);
    } else {
      navigate(`/upload?date=${iso}`);
    }
  }

  function onTileKey(e: KeyboardEvent<HTMLButtonElement>, day: number): void {
    setFocusedDay(day);
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveFocus(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(-7);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(7);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(-mondayFirstWeekday(new Date(year, monthIndex, day).getDay()));
        break;
      case 'End': {
        e.preventDefault();
        const dow = mondayFirstWeekday(new Date(year, monthIndex, day).getDay());
        moveFocus(6 - dow);
        break;
      }
      case 'PageUp':
        e.preventDefault();
        moveMonth(-1);
        break;
      case 'PageDown':
        e.preventDefault();
        moveMonth(1);
        break;
      default:
        break;
    }
  }

  // Compose tiles: leading blanks + days
  const tiles: Array<{ day: number | null; iso?: string }> = [];
  for (let i = 0; i < monthInfo.leading; i += 1) tiles.push({ day: null });
  for (let d = 1; d <= monthInfo.daysInMonth; d += 1) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    tiles.push({ day: d, iso });
  }
  // Pad trailing to multiple of 7
  while (tiles.length % 7 !== 0) tiles.push({ day: null });
  const rows: typeof tiles[] = [];
  for (let i = 0; i < tiles.length; i += 7) rows.push(tiles.slice(i, i + 7));

  return (
    <AppShell>
      <div className="flex flex-col gap-6" data-calendar="true">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-3xl font-semibold text-ink-900">
            {formatMonthYear(year, monthIndex)}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => moveMonth(-1)}
              aria-label="Previous month"
            >
              ‹
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => moveMonth(1)}
              aria-label="Next month"
            >
              ›
            </Button>
            <Link
              to="/upload"
              className="ml-2 inline-flex h-8 items-center rounded-sm bg-accent-700 px-3 text-sm font-medium text-surface-card hover:bg-accent-600"
            >
              + New entry
            </Link>
          </div>
        </header>

        {loadError ? (
          <Banner tone="danger" title="Could not load entries">
            {loadError}
          </Banner>
        ) : null}

        <table
          role="grid"
          aria-label={`Calendar — ${formatMonthYear(year, monthIndex)}`}
          className="w-full border-collapse text-center"
        >
          <thead>
            <tr>
              {WEEKDAYS.map((wd) => (
                <th
                  key={wd}
                  scope="col"
                  className="pb-2 text-xs font-medium uppercase tracking-wide text-ink-500"
                >
                  {wd}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {row.map((tile, colIdx) => {
                  if (tile.day === null) {
                    return <td key={colIdx} className="p-1" aria-hidden="true" />;
                  }
                  const day = tile.day;
                  const iso = tile.iso!;
                  const future = isFuture(year, monthIndex, day);
                  const hasEntry = entriesByDate.has(iso);
                  const entry = entriesByDate.get(iso);
                  const isToday =
                    year === todayY && monthIndex === todayM - 1 && day === todayD;
                  const isFocused = day === focusedDay;
                  return (
                    <td key={colIdx} className="p-1">
                      <button
                        ref={(el) => {
                          tileRefs.current.set(day, el);
                        }}
                        type="button"
                        disabled={future}
                        aria-disabled={future || undefined}
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={
                          isToday
                            ? `Today, ${formatLongDate(iso)}${hasEntry ? ' — entry' : ''}`
                            : `${formatLongDate(iso)}${hasEntry ? ' — entry' : future ? ' — future, no entry yet' : ''}`
                        }
                        tabIndex={isFocused ? 0 : -1}
                        onFocus={() => setFocusedDay(day)}
                        onClick={() => activate(day)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            activate(day);
                            return;
                          }
                          onTileKey(e, day);
                        }}
                        className={[
                          'flex aspect-square w-full items-center justify-center rounded-md border text-sm transition-colors duration-fast',
                          future
                            ? 'cursor-not-allowed border-border-subtle bg-surface-page text-ink-300'
                            : hasEntry
                              ? 'border-border-subtle bg-cover bg-center text-surface-card shadow-sm'
                              : 'border-border-subtle bg-surface-card text-ink-500 hover:bg-surface-raised',
                          isToday ? 'ring-2 ring-accent-500' : '',
                        ].join(' ')}
                        style={
                          hasEntry && entry?.thumbnailUrl
                            ? {
                                backgroundImage: `linear-gradient(rgba(26,23,20,0.4), rgba(26,23,20,0.4)), url(${JSON.stringify(entry.thumbnailUrl)})`,
                              }
                            : undefined
                        }
                      >
                        <span
                          className={hasEntry ? 'font-semibold drop-shadow' : ''}
                        >
                          {day}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <RecentList entries={recent} />
      </div>
    </AppShell>
  );
}

function RecentList({ entries }: { entries: EntrySummary[] }) {
  if (entries.length === 0) {
    return (
      <section className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-surface-card p-6 text-center">
        <p className="text-base text-ink-700">Nothing here yet.</p>
        <p className="text-sm text-ink-500">Start with today&apos;s photos.</p>
        <Link
          to="/upload"
          className="inline-flex h-10 items-center rounded-sm bg-accent-700 px-4 text-sm font-medium text-surface-card hover:bg-accent-600"
        >
          + New entry
        </Link>
      </section>
    );
  }
  return (
    <nav aria-label="Recent entries" className="flex flex-col gap-2">
      <h2 className="font-heading text-xl font-semibold text-ink-900">Recent</h2>
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id}>
            <Link
              to={`/entries/${e.id}`}
              className="block rounded-md border border-border-subtle bg-surface-card p-3 hover:bg-surface-raised"
            >
              <p className="text-sm font-medium text-ink-900">
                {formatLongDate(e.entryDate, { withYear: true })}
                {e.placeName ? ` — ${e.placeName}` : ''}
                {typeof e.photoCount === 'number' ? ` · ${e.photoCount} photos` : ''}
              </p>
              {e.excerpt ? <p className="mt-1 text-sm text-ink-700">{e.excerpt}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
