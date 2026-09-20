import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from './components/AppShell';
import CalendarPage from './pages/CalendarPage';
import DashboardPage from './pages/DashboardPage';
import JournalDayPage from './pages/JournalDayPage';
import JournalYearPage from './pages/JournalYearPage';
import NewNotePage from './pages/NewNotePage';
import NoteDetailPage from './pages/NoteDetailPage';
import NotesListPage from './pages/NotesListPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ProjectsListPage from './pages/ProjectsListPage';
import SettingsPage from './pages/SettingsPage';
import { todayStr, yearOf } from './lib/date';
import { UnsavedChangesProvider } from './lib/unsavedChanges';

export default function App() {
  const today = todayStr();

  return (
    // Wraps the whole routed tree (not just AppShell) so both the global
    // keyboard shortcuts (mounted in AppShell, outside the routed Outlet)
    // and every page's forms (mounted inside it) share the same dirty-form
    // registry — see lib/unsavedChanges.tsx.
    <UnsavedChangesProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsListPage />} />
          <Route path="projects/:slug" element={<ProjectDetailPage />} />
          <Route path="notes" element={<NotesListPage />} />
          {/* Listed before the :slug route for readability — React Router
              ranks a literal segment over a dynamic one regardless of
              declaration order, so "new" can never be shadowed by a real
              note's slug (services/notes.ts also reserves it, so a note
              titled "New" can never actually slugify to "new" and collide). */}
          <Route path="notes/new" element={<NewNotePage />} />
          <Route path="notes/:slug" element={<NoteDetailPage />} />
          {/* PLAN.md: "/journal -> redirect to /journal/<year>/<today>" */}
          <Route path="journal" element={<Navigate to={`/journal/${yearOf(today)}/${today}`} replace />} />
          <Route path="journal/:year" element={<JournalYearPage />} />
          <Route path="journal/:year/:date" element={<JournalDayPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </UnsavedChangesProvider>
  );
}
