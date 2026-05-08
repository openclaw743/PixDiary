import { Route, Routes } from 'react-router-dom';

import { RequireAuth } from '@/auth/RequireAuth';
import CalendarPage from '@/pages/Calendar';
import EntryPage from '@/pages/Entry';
import LoginPage from '@/pages/Login';
import SettingsPage from '@/pages/Settings';
import SignupPage from '@/pages/Signup';
import UploadPage from '@/pages/Upload';
import PlaceholderPage from '@/pages/__placeholder__';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireAuth>
            <UploadPage />
          </RequireAuth>
        }
      />
      <Route
        path="/entries/:id"
        element={
          <RequireAuth>
            <EntryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/calendar"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <PlaceholderPage
            title="Page not found"
            description="That URL is not part of PixDiary. Try the home page."
          />
        }
      />
    </Routes>
  );
}
