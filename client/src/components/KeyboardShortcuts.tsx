import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { todayStr, yearOf } from '../lib/date';
import { useUnsavedChangesGuard } from '../lib/unsavedChanges';
import QuickAddTaskModal from './QuickAddTaskModal';

/** Cmd/Ctrl+1..5 and Cmd/Ctrl+, — one per sidebar nav item, same
 * top-to-bottom order, "," for Settings matching the VS Code/Slack/macOS
 * convention for a preferences shortcut. `/journal` (not a specific date)
 * so it goes through the same "-> today" redirect as clicking the sidebar's
 * own Journal link. */
const NAV_SHORTCUTS: Record<string, string> = {
  '1': '/',
  '2': '/projects',
  '3': '/notes',
  '4': '/journal',
  '5': '/calendar',
  ',': '/settings',
};

/**
 * Global keyboard shortcuts — mounted once in `AppShell`, *outside* the
 * routed `Outlet`, so it stays mounted (and listening) across every page
 * rather than needing to be repeated per-page. Handles:
 *
 * - Cmd/Ctrl+1..5, Cmd/Ctrl+, — jump straight to a sidebar destination
 *   (`NAV_SHORTCUTS` above).
 * - Cmd/Ctrl+T — quick-add a task from anywhere, via the same
 *   `QuickAddTaskModal` the Dashboard's own "+ Add task" button opens.
 * - Cmd/Ctrl+J — jump to today's journal entry with the editor already
 *   focused, ready to type (vs. plain Cmd/Ctrl+4, which just opens the
 *   page).
 *
 * No Shift needed for T/J — nothing else in the app claims plain Cmd/Ctrl+T
 * or +J, and (like the digit/comma shortcuts) this is a single-`BrowserWindow`
 * Electron app with no tab strip, so neither key's usual browser-chrome
 * meaning (new tab / bookmarks) applies here.
 *
 * Every one of these can navigate away from a half-filled form elsewhere on
 * the current page (a task/project `Modal`, the compact add-task row) —
 * each checks `useUnsavedChangesGuard` first and backs out silently if the
 * user declines the confirmation, same as a browser's own "leave site?"
 * prompt.
 */
export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const confirmNavigation = useUnsavedChangesGuard();
  const [quickAddTaskOpen, setQuickAddTaskOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;

      const key = e.key.toLowerCase();

      if (key === 't') {
        e.preventDefault();
        if (!confirmNavigation()) return;
        setQuickAddTaskOpen(true);
        return;
      }

      if (key === 'j') {
        e.preventDefault();
        if (!confirmNavigation()) return;
        setQuickAddTaskOpen(false);
        const today = todayStr();
        navigate(`/journal/${yearOf(today)}/${today}`, { state: { focusEditor: true } });
        return;
      }

      const path = NAV_SHORTCUTS[e.key];
      if (!path) return;
      e.preventDefault();
      if (!confirmNavigation()) return;
      setQuickAddTaskOpen(false);
      navigate(path);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, confirmNavigation]);

  return quickAddTaskOpen ? <QuickAddTaskModal onClose={() => setQuickAddTaskOpen(false)} /> : null;
}
