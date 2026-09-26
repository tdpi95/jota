// App-wide preferences (PLAN.md "Daily reminder" — milestone 17), not
// scoped to any workspace. Currently just the launch-at-login *preference
// record*: `electron/src/main.ts` uses this to know whether it's already
// applied the one-time "on by default for a new install" logic, and to
// persist the user's explicit choice afterward — the live OS truth is
// always read straight from `app.getLoginItemSettings()` in the Electron
// main process, never from here (see services/workspaces.ts).

import { Router } from 'express';

import * as workspaceService from '../services/workspaces.js';

const router = Router();

router.get('/launch-at-login', (_req, res) => {
  res.json({ enabled: workspaceService.getLaunchAtLoginPreference() });
});

router.put('/launch-at-login', (req, res, next) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (boolean) is required' });
      return;
    }
    res.json({ enabled: workspaceService.setLaunchAtLoginPreference(enabled) });
  } catch (err) {
    next(err);
  }
});

// App-wide UI language (PLAN.md "Localization") — read by the client
// directly (no Electron bridge needed, unlike launch-at-login/reminder:
// there's no OS-level API involved) and polled by the Electron main
// process for the tray menu and daily-reminder notification text.
router.get('/language', (_req, res) => {
  res.json({ language: workspaceService.getLanguagePreference() });
});

router.put('/language', (req, res, next) => {
  try {
    const { language } = req.body ?? {};
    if (language !== 'en' && language !== 'vi') {
      res.status(400).json({ error: "language must be 'en' or 'vi'" });
      return;
    }
    res.json({ language: workspaceService.setLanguagePreference(language) });
  } catch (err) {
    next(err);
  }
});

// App-wide UI theme + accent palette (PLAN.md "Theming") — same shape as
// /language above; read/written directly over HTTP, no Electron bridge
// needed (a color theme touches no OS-level API either).
router.get('/theme', (_req, res) => {
  res.json({ theme: workspaceService.getThemePreference() });
});

router.put('/theme', (req, res, next) => {
  try {
    const { theme } = req.body ?? {};
    if (theme !== 'light' && theme !== 'dark') {
      res.status(400).json({ error: "theme must be 'light' or 'dark'" });
      return;
    }
    res.json({ theme: workspaceService.setThemePreference(theme) });
  } catch (err) {
    next(err);
  }
});

router.get('/accent-palette', (_req, res) => {
  res.json({ accentPalette: workspaceService.getAccentPalettePreference() });
});

router.put('/accent-palette', (req, res, next) => {
  try {
    const { accentPalette } = req.body ?? {};
    if (!['default', 'green', 'blue', 'violet'].includes(accentPalette)) {
      res.status(400).json({ error: "accentPalette must be one of 'default', 'green', 'blue', 'violet'" });
      return;
    }
    res.json({ accentPalette: workspaceService.setAccentPalettePreference(accentPalette) });
  } catch (err) {
    next(err);
  }
});

// CalendarPage's due/journal toggle (PLAN.md "Frontend Calendar page") —
// same shape as /theme and /accent-palette above, no Electron bridge needed.
router.get('/calendar-mode', (_req, res) => {
  res.json({ calendarMode: workspaceService.getCalendarModePreference() });
});

router.put('/calendar-mode', (req, res, next) => {
  try {
    const { calendarMode } = req.body ?? {};
    if (calendarMode !== 'due' && calendarMode !== 'journal') {
      res.status(400).json({ error: "calendarMode must be 'due' or 'journal'" });
      return;
    }
    res.json({ calendarMode: workspaceService.setCalendarModePreference(calendarMode) });
  } catch (err) {
    next(err);
  }
});

// CalendarPage's month/year granularity — same shape as /calendar-mode
// above.
router.get('/calendar-granularity', (_req, res) => {
  res.json({ calendarGranularity: workspaceService.getCalendarGranularityPreference() });
});

router.put('/calendar-granularity', (req, res, next) => {
  try {
    const { calendarGranularity } = req.body ?? {};
    if (calendarGranularity !== 'month' && calendarGranularity !== 'year') {
      res.status(400).json({ error: "calendarGranularity must be 'month' or 'year'" });
      return;
    }
    res.json({ calendarGranularity: workspaceService.setCalendarGranularityPreference(calendarGranularity) });
  } catch (err) {
    next(err);
  }
});

// Journal editor's autosave debounce, in seconds (PLAN.md "Journal editor")
// — same shape as /calendar-mode above, no Electron bridge needed. Bounds
// come from services/workspaces.ts so the route and the preference itself
// never drift out of sync.
router.get('/autosave-interval', (_req, res) => {
  res.json({ autosaveIntervalSeconds: workspaceService.getAutosaveIntervalPreference() });
});

router.put('/autosave-interval', (req, res, next) => {
  try {
    const { autosaveIntervalSeconds } = req.body ?? {};
    const { AUTOSAVE_INTERVAL_MIN_SECONDS: min, AUTOSAVE_INTERVAL_MAX_SECONDS: max } = workspaceService;
    if (typeof autosaveIntervalSeconds !== 'number' || !Number.isInteger(autosaveIntervalSeconds) || autosaveIntervalSeconds < min || autosaveIntervalSeconds > max) {
      res.status(400).json({ error: `autosaveIntervalSeconds must be an integer between ${min} and ${max}` });
      return;
    }
    res.json({ autosaveIntervalSeconds: workspaceService.setAutosaveIntervalPreference(autosaveIntervalSeconds) });
  } catch (err) {
    next(err);
  }
});

// Dashboard's "Pinned" section collapse state — same shape as
// /calendar-mode above.
router.get('/dashboard-pinned-open', (_req, res) => {
  res.json({ open: workspaceService.getDashboardPinnedOpenPreference() });
});

router.put('/dashboard-pinned-open', (req, res, next) => {
  try {
    const { open } = req.body ?? {};
    if (typeof open !== 'boolean') {
      res.status(400).json({ error: 'open (boolean) is required' });
      return;
    }
    res.json({ open: workspaceService.setDashboardPinnedOpenPreference(open) });
  } catch (err) {
    next(err);
  }
});

// Dashboard's group-filter selection (milestone 26 follow-up) — same shape
// as /dashboard-pinned-open above.
router.get('/dashboard-group-filter', (_req, res) => {
  res.json({ groups: workspaceService.getDashboardGroupFilterPreference() });
});

router.put('/dashboard-group-filter', (req, res, next) => {
  try {
    const { groups } = req.body ?? {};
    if (!Array.isArray(groups) || !groups.every((g) => typeof g === 'string')) {
      res.status(400).json({ error: 'groups (string[]) is required' });
      return;
    }
    res.json({ groups: workspaceService.setDashboardGroupFilterPreference(groups) });
  } catch (err) {
    next(err);
  }
});

// Dashboard's pinned-projects/pinned-notes selections (replaces "Recent
// projects") — same shape as /dashboard-group-filter above.
router.get('/pinned-projects', (_req, res) => {
  res.json({ slugs: workspaceService.getPinnedProjectsPreference() });
});

router.put('/pinned-projects', (req, res, next) => {
  try {
    const { slugs } = req.body ?? {};
    if (!Array.isArray(slugs) || !slugs.every((s) => typeof s === 'string')) {
      res.status(400).json({ error: 'slugs (string[]) is required' });
      return;
    }
    res.json({ slugs: workspaceService.setPinnedProjectsPreference(slugs) });
  } catch (err) {
    next(err);
  }
});

router.get('/pinned-notes', (_req, res) => {
  res.json({ slugs: workspaceService.getPinnedNotesPreference() });
});

router.put('/pinned-notes', (req, res, next) => {
  try {
    const { slugs } = req.body ?? {};
    if (!Array.isArray(slugs) || !slugs.every((s) => typeof s === 'string')) {
      res.status(400).json({ error: 'slugs (string[]) is required' });
      return;
    }
    res.json({ slugs: workspaceService.setPinnedNotesPreference(slugs) });
  } catch (err) {
    next(err);
  }
});

// NoteBodyEditor's Edit/Preview toggle — same shape as /dashboard-pinned-open
// above.
router.get('/note-view-mode', (_req, res) => {
  res.json({ noteViewMode: workspaceService.getNoteViewModePreference() });
});

router.put('/note-view-mode', (req, res, next) => {
  try {
    const { noteViewMode } = req.body ?? {};
    if (noteViewMode !== 'edit' && noteViewMode !== 'preview') {
      res.status(400).json({ error: "noteViewMode must be 'edit' or 'preview'" });
      return;
    }
    res.json({ noteViewMode: workspaceService.setNoteViewModePreference(noteViewMode) });
  } catch (err) {
    next(err);
  }
});

// Dashboard weather widget's location (picked via Nominatim search in
// Settings; the weather itself is fetched client-side from Open-Meteo).
// `{ location: null }` clears it.
router.get('/weather-location', (_req, res) => {
  res.json({ location: workspaceService.getWeatherLocationPreference() });
});

router.put('/weather-location', (req, res, next) => {
  try {
    const { location } = req.body ?? {};
    if (location === null) {
      res.json({ location: workspaceService.setWeatherLocationPreference(null) });
      return;
    }
    const { name, latitude, longitude } = location ?? {};
    if (
      typeof name !== 'string' ||
      name.trim() === '' ||
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      res.status(400).json({ error: 'location ({ name, latitude, longitude } or null) is required' });
      return;
    }
    res.json({ location: workspaceService.setWeatherLocationPreference({ name: name.trim(), latitude, longitude }) });
  } catch (err) {
    next(err);
  }
});

// Weather widget's temperature unit (conversion happens client-side;
// Open-Meteo is always queried in Celsius).
router.get('/temperature-unit', (_req, res) => {
  res.json({ temperatureUnit: workspaceService.getTemperatureUnitPreference() });
});

router.put('/temperature-unit', (req, res, next) => {
  try {
    const { temperatureUnit } = req.body ?? {};
    if (temperatureUnit !== 'celsius' && temperatureUnit !== 'fahrenheit') {
      res.status(400).json({ error: "temperatureUnit ('celsius' | 'fahrenheit') is required" });
      return;
    }
    res.json({ temperatureUnit: workspaceService.setTemperatureUnitPreference(temperatureUnit) });
  } catch (err) {
    next(err);
  }
});

export default router;
