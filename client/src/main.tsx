import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { ApiError, getAccentPalettePreference, getLanguagePreference, getThemePreference } from './api/client';
import App from './App';
import i18n from './i18n';
import { applyAccentPalette, applyTheme } from './lib/theme';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Aggregate endpoints (search, calendar, etc.) read from the SQLite
      // index and can be briefly stale per PLAN.md's own documented
      // trade-off — a short staleTime avoids refetching on every focus
      // event while still picking up changes made elsewhere reasonably
      // soon. Mutations invalidate the exact queries they affect directly.
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // Never retry a 4xx (a bad slug/id isn't going to start existing on
      // retry #2) — TanStack Query's default of 3 retries with backoff
      // otherwise leaves a real window where `isLoading` has already gone
      // false (between retry attempts) but `isError` hasn't gone true yet
      // (retries not exhausted), so `data` is still undefined and neither
      // loading nor error guard in the page catches it. 5xx/network errors
      // still get the default retry behavior.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.statusCode < 500) return false;
        return failureCount < 3;
      },
    },
  },
});

// The app-wide UI language (PLAN.md "Localization") and theme + accent
// palette (PLAN.md "Theming") are all fetched once, in parallel, before the
// first render, rather than defaulting and flashing a switch a moment later
// — these preferences rarely change and the extra round trip is a few ms
// against localhost. Each falls back to its own default on any failure
// (fresh registry, server hiccup): 'en' for language (i18next's own
// `fallbackLng` already covers this too, but resolving it explicitly avoids
// a startup render in the wrong language while the fetch is still in
// flight), 'light'/'default' for theme/palette.
Promise.all([
  getLanguagePreference()
    .then(({ language }) => i18n.changeLanguage(language))
    .catch(() => {
      /* stay on i18n's initial 'en' */
    }),
  getThemePreference()
    .then(({ theme }) => applyTheme(theme))
    .catch(() => applyTheme('light')),
  getAccentPalettePreference()
    .then(({ accentPalette }) => applyAccentPalette(accentPalette))
    .catch(() => applyAccentPalette('default')),
])
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
  });
