import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { todayStr, yearOf } from '../lib/date';
import { useUnsavedChangesGuard } from '../lib/unsavedChanges';
import QuickAddTaskModal from './QuickAddTaskModal';
import SearchModal from './SearchModal';

/** Cmd/Ctrl+1..5 and Cmd/Ctrl+, — one per sidebar nav item, same
 * top-to-bottom order, "," for Settings matching the VS Code/Slack/macOS
 * convention for a preferences shortcut. `/journal` (not a specific date)
 * so it goes through the same "-> today" redirect as clicking the sidebar's
 * own Journal link. */
const NAV_SHORTCUTS: Record<string, string> = {
  '1': '/',
  '2': '/projects',
  '3': '/journal',
  '4': '/notes',
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
 * - Cmd/Ctrl+K — open the "search everything" popup (`SearchModal`) from
 *   any page. Originally Dashboard-only (a plain `useEffect` window
 *   listener scoped to that one page's lifetime) — moved here after a
 *   report that it silently did nothing anywhere else, since the listener
 *   that handled it simply wasn't mounted once you'd navigated away.
 * - Cmd/Ctrl+T — quick-add a task from anywhere, via the same
 *   `QuickAddTaskModal` the Dashboard's own "+ Add task" button opens.
 * - Cmd/Ctrl+J — jump to today's journal entry with the editor already
 *   focused, ready to type (vs. plain Cmd/Ctrl+3, which just opens the
 *   page).
 *
 * No Shift needed for K/T/J — nothing else in the app claims plain
 * Cmd/Ctrl+K/T/J, and (like the digit/comma shortcuts) this is a
 * single-`BrowserWindow` Electron app with no tab strip, so none of these
 * keys' usual browser-chrome meaning (new tab / bookmarks / address-bar
 * search) applies here.
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
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;

      const key = e.key.toLowerCase();

      if (key === 'k') {
        e.preventDefault();
        if (!confirmNavigation()) return;
        setSearchOpen(true);
        return;
      }

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
        setSearchOpen(false);
        const today = todayStr();
        navigate(`/journal/${yearOf(today)}/${today}`, { state: { focusEditor: true } });
        return;
      }

      const path = NAV_SHORTCUTS[e.key];
      if (!path) return;
      e.preventDefault();
      if (!confirmNavigation()) return;
      setQuickAddTaskOpen(false);
      setSearchOpen(false);
      navigate(path);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, confirmNavigation]);

  return (
    <>
      {quickAddTaskOpen && <QuickAddTaskModal onClose={() => setQuickAddTaskOpen(false)} />}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
    </>
  );
}
