import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from './components/AppShell';
import DashboardPage from './pages/DashboardPage';
import JournalDayPage from './pages/JournalDayPage';
import JournalYearPage from './pages/JournalYearPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import ProjectsListPage from './pages/ProjectsListPage';
import SettingsPage from './pages/SettingsPage';
import { todayStr, yearOf } from './lib/date';

export default function App() {
  const today = todayStr();

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsListPage />} />
        <Route path="projects/:slug" element={<ProjectDetailPage />} />
        {/* PLAN.md: "/journal -> redirect to /journal/<year>/<today>" */}
        <Route path="journal" element={<Navigate to={`/journal/${yearOf(today)}/${today}`} replace />} />
        <Route path="journal/:year" element={<JournalYearPage />} />
        <Route path="journal/:year/:date" element={<JournalDayPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
