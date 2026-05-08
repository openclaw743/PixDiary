import { Route, Routes } from 'react-router-dom';

import { RequireAuth } from '@/auth/RequireAuth';
import LoginPage from '@/pages/Login';
import SignupPage from '@/pages/Signup';
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
            <PlaceholderPage
              title="Today"
              description="Your diary timeline lives here. Coming in the next milestone."
            />
          </RequireAuth>
        }
      />
      <Route
        path="/upload"
        element={
          <RequireAuth>
            <PlaceholderPage
              title="Upload photos"
              description="Drag-drop photo upload arrives in the next milestone."
            />
          </RequireAuth>
        }
      />
      <Route
        path="/entries/:id"
        element={
          <RequireAuth>
            <PlaceholderPage
              title="Diary entry"
              description="Inline edit + save view arrives in the next milestone."
            />
          </RequireAuth>
        }
      />
      <Route
        path="/calendar"
        element={
          <RequireAuth>
            <PlaceholderPage
              title="Calendar"
              description="Browse past entries by month — coming in the next milestone."
            />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <PlaceholderPage
              title="Settings"
              description="Daily AI cap, timezone, export, and account deletion — next milestone."
            />
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
