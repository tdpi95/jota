import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { ApiError, getLanguagePreference } from './api/client';
import App from './App';
import i18n from './i18n';
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

// The app-wide UI language (PLAN.md "Localization") is fetched once before
// the first render, rather than defaulting to 'en' and flashing a switch a
// moment later — this preference rarely changes and the extra round trip
// is a few ms against localhost. Falls back to 'en' on any failure (fresh
// registry, server hiccup) — i18next's own `fallbackLng` already covers
// this too, but resolving it explicitly avoids a startup render in the
// wrong language while the fetch is still in flight.
getLanguagePreference()
  .then(({ language }) => i18n.changeLanguage(language))
  .catch(() => {
    /* stay on i18n's initial 'en' */
  })
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
