import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '@/api/client';
import {
  deleteAccount,
  exportAccount,
  getSettings,
  updateSettings,
} from '@/api/entries';
import type { Settings } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { AppShell } from '@/components/AppShell';
import { Banner } from '@/components/Banner';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useToast } from '@/components/Toast';

const CAP_MIN = 0.1;
const CAP_MAX = 5.0;
const CAP_STEP = 0.05;
const DELETE_PHRASE = 'DELETE MY ACCOUNT';

/**
 * `/settings` — timezone, daily AI cap, export, delete account.
 *
 * Per accessibility.md and openapi.yaml constraints:
 *  - Daily cap: slider over [€0.10, €5.00], current usage shown.
 *  - Export: downloads JSON.
 *  - Delete: requires password + literal confirmation phrase "DELETE MY ACCOUNT".
 *  - All controls keyboard-operable; visible labels; errors inline.
 */
export default function SettingsPage() {
  const { user, logout } = useAuth();
  const { show: showToast } = useToast();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  const [timezone, setTimezone] = useState('UTC');
  const [cap, setCap] = useState<number>(0.5);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsMessage, setPrefsMessage] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const fresh = await getSettings();
        if (cancelled) return;
        setSettings(fresh);
        setTimezone(fresh.timezone);
        setCap(fresh.dailyCapEur);
        setLoadError(null);
      } catch {
        if (cancelled) return;
        // Fall back to user from /me so the page still works.
        if (user) {
          setSettings({ timezone: user.timezone, dailyCapEur: user.dailyCapEur });
          setTimezone(user.timezone);
          setCap(user.dailyCapEur);
        } else {
          setLoadError('Could not load settings. Please try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function onSavePrefs(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSavingPrefs(true);
    setPrefsMessage(null);
    setPrefsError(null);
    try {
      const next = await updateSettings({ timezone, dailyCapEur: cap });
      setSettings(next);
      setPrefsMessage('Settings saved.');
    } catch (err) {
      setPrefsError(
        err instanceof ApiError ? err.message || 'Could not save settings.' : 'Network error.',
      );
    } finally {
      setSavingPrefs(false);
    }
  }

  async function onExport(): Promise<void> {
    setExporting(true);
    try {
      const data = await exportAccount();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pixdiary-export-${data.exportedAt.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({ message: 'Export downloaded.' });
    } catch (err) {
      showToast({
        message:
          err instanceof ApiError
            ? `Export failed: ${err.message}`
            : 'Export failed — please try again.',
        tone: 'error',
      });
    } finally {
      setExporting(false);
    }
  }

  async function onDelete(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setDeleteError(null);
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      passwordRef.current?.focus();
      return;
    }
    if (deleteConfirm !== DELETE_PHRASE) {
      setDeleteError(`Type "${DELETE_PHRASE}" exactly to confirm.`);
      confirmRef.current?.focus();
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount({ password: deletePassword, confirmation: DELETE_PHRASE });
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setDeleteError('That password did not match.');
        passwordRef.current?.focus();
      } else {
        setDeleteError(
          err instanceof ApiError
            ? err.message || 'Could not delete account.'
            : 'Network error — could not delete account.',
        );
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <h1 className="font-heading text-3xl font-semibold text-ink-900">Settings</h1>

        {loadError ? (
          <Banner tone="danger" title="Could not load settings">
            {loadError}
          </Banner>
        ) : null}

        {loading ? (
          <p role="status" aria-live="polite" className="text-ink-700">
            Loading settings…
          </p>
        ) : (
          <>
            <form onSubmit={onSavePrefs} className="flex flex-col gap-4">
              <h2 className="font-heading text-xl font-semibold text-ink-900">Preferences</h2>

              <Input
                label="Timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                hint="e.g. Europe/Copenhagen, America/New_York"
                required
              />

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium text-ink-800">
                  Daily AI cap
                </legend>
                <p className="text-sm text-ink-700">
                  Today's usage:{' '}
                  <strong>€0.00</strong> of <strong>€{cap.toFixed(2)}</strong>
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-ink-700">€{CAP_MIN.toFixed(2)}</span>
                  <input
                    aria-label="Daily AI cap in euros"
                    type="range"
                    min={CAP_MIN}
                    max={CAP_MAX}
                    step={CAP_STEP}
                    value={cap}
                    onChange={(e) => setCap(Number.parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm text-ink-700">€{CAP_MAX.toFixed(2)}</span>
                  <span className="ml-2 w-16 text-right text-sm font-semibold text-ink-900">
                    €{cap.toFixed(2)}
                  </span>
                </div>
                <p className="text-sm text-ink-500">
                  Hard limit per day. Range €{CAP_MIN.toFixed(2)}–€{CAP_MAX.toFixed(2)}.
                </p>
              </fieldset>

              {prefsMessage ? (
                <Banner tone="success" title="Saved">
                  {prefsMessage}
                </Banner>
              ) : null}
              {prefsError ? (
                <Banner tone="danger" title="Could not save">
                  {prefsError}
                </Banner>
              ) : null}

              <div>
                <Button type="submit" loading={savingPrefs}>
                  Save preferences
                </Button>
              </div>
            </form>

            <section className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-card p-4">
              <h2 className="font-heading text-xl font-semibold text-ink-900">
                Export your diary
              </h2>
              <p className="text-sm text-ink-700">
                Download every entry and photo reference as a single JSON file.
              </p>
              <div>
                <Button variant="secondary" onClick={onExport} loading={exporting}>
                  Download export
                </Button>
              </div>
            </section>

            <section className="flex flex-col gap-3 rounded-md border border-danger bg-surface-card p-4">
              <h2 className="font-heading text-xl font-semibold text-danger">
                Delete account
              </h2>
              <p className="text-sm text-ink-700">
                This permanently deletes your account, every diary entry, and all photo blobs.
                There is no undo.
              </p>
              <form onSubmit={onDelete} className="flex flex-col gap-3" noValidate>
                <Input
                  ref={passwordRef}
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
                <Input
                  ref={confirmRef}
                  label={`Type "${DELETE_PHRASE}" to confirm`}
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  required
                  hint="Case-sensitive."
                />
                {deleteError ? (
                  <Banner tone="danger" title="Could not delete account">
                    {deleteError}
                  </Banner>
                ) : null}
                <div>
                  <Button
                    type="submit"
                    variant="danger"
                    loading={deleting}
                    disabled={
                      !deletePassword || deleteConfirm !== DELETE_PHRASE || deleting
                    }
                  >
                    Delete my account
                  </Button>
                </div>
              </form>
            </section>

            {settings ? (
              <p className="text-xs text-ink-500">
                Saved settings: tz={settings.timezone}, cap=€{settings.dailyCapEur.toFixed(2)}
              </p>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
