# Milestone 30 notes (Weather widget)

[← back to PROGRESS.md](../../PROGRESS.md)

Requested by the user (2026-09-26): "use open meteo api to get weather info and display icon next to dashboard header. add a section in settings allow user to find location using Nominatim (OpenStreetMap) api. keep the red plane if there is no location and weather info otherwise show weather icon in the plane position. show more weather info in tooltip when hovering over weather icon." Design summary in PLAN.md, "Weather widget".

## Build

- **Server** (preference only): `WeatherLocation` type + `weatherLocation?` on `WorkspaceRegistry` (`lib/workspaces.ts`); `get/setWeatherLocationPreference` (`services/workspaces.ts`); `GET/PUT /api/preferences/weather-location` (`routes/preferences.ts`). The PUT validates `name` (non-empty string) and finite `latitude`/`longitude` within ±90/±180, or accepts `null` to clear.
- **Client**:
  - `lib/weather.ts`: `searchLocations` (Nominatim `jsonv2`, `addressdetails=1`, `accept-language` = UI language, stored name shortened to `"<name>, <country>"`), `fetchCurrentWeather` (Open-Meteo, `timezone=auto`, `forecast_days=1`), and the WMO-code → condition → icon-kind mapping.
  - `components/WeatherWidget.tsx`: replaces the `<img>` in `DashboardPage`'s title row. It renders the plane unless both the location and the weather data are present. The icons are inline SVG, with colors in `app.css` `.wx-*` classes and cloud fills that switch under `[data-theme="dark"]`. The tooltip is CSS-only (`:hover`/`:focus-visible`), and the widget is `tabIndex=0` so keyboard users can reach it.
  - `SettingsPage`: "Weather" section above Autosave, with the current location + Remove, a search form (submit-only), a result list with a "Use" button per result, and an attribution line.
  - i18n: `settings.weather.*` and top-level `weather.*` (tooltip labels + all WMO condition names), in en + vi.
- **Why the renderer, not Express**: both APIs are keyless and send CORS headers. The embedded Node server's global `fetch` ignores proxy env/OS settings, but Chromium's network stack in the Electron renderer respects them. The dev machine is behind an HTTPS proxy, which made the difference concrete.

## Verified live (2026-09-26, `jota-dev` preview)

- With no location set, the Dashboard showed the plane, and Settings said "No location set".
- Searched "Hanoi" in Settings, got Nominatim results, and clicked Use. "Current location: Hà Nội, Vietnam" appeared.
- The Dashboard then showed a sun icon + "29°" in the plane's slot. Hovering showed the tooltip: HÀ NỘI, VIETNAM · 29°C Clear sky · Feels like 34°C · High/Low 32°/26° · Humidity 88% · Wind 14 km/h · Chance of rain 87% · Updated 04:43 PM.
- All ten icon variants (clear day/night, partly cloudy day/night, cloudy, fog, drizzle, rain, snow, thunder) rendered correctly in a throwaway gallery page that used the same paths and CSS.
- `tsc --noEmit` is clean for client and server, and `npm test` passes (205 tests). The user's `~/.jota/config.json` was restored to its pre-test state afterwards.

## Follow-up: animated Meteocons icons (2026-09-26)

- User request: "use animated line icons from https://github.com/basmilius/meteocons. keep WeatherWidget for reuse later." The hand-drawn `WeatherWidget.tsx` is left as-is but unused. The new `AnimatedWeatherWidget.tsx` has the same data, tooltip, and plane fallback, and the Dashboard now uses it.
- **Source**: the GitHub repo doesn't contain built SVGs (they're exported from Figma by its pipeline). The published `@meteocons/svg@0.1.0` npm package (MIT) has them, so that's a client dependency now. `lib/meteocons.ts` imports 21 icons one by one (not globbed, so the other ~450 aren't bundled) and maps WMO codes to them: 0/1/2 → clear/mostly-clear/partly-cloudy day|night; 3 → overcast; 45/48 → fog day|night; drizzle; freezing drizzle/rain → sleet; rain; snow; showers → partly-cloudy-*-rain/snow; 95 → thunderstorms-*-rain; 96/99 → thunderstorms-hail; else not-available.
- **Theme problem found in testing**: the line style is drawn for dark backgrounds. Cloud outlines are filled `#E6EFFC` and fog lines stroked `#E2E8F0`, so on Jota's light theme the clouds almost disappeared. "not-available" is `#202939`, which disappears on dark. Fix: import each SVG `?raw`, and build light (`#E6EFFC`/`#E2E8F0` → `#64748B`) and dark (`#202939` → `#E2E8F0`) data URLs, cached. The widget renders both `<img>`s, and `app.css` shows the one matching `[data-theme]`, so a theme switch needs no React re-render.
- **Why `<img>`, not inline SVG**: SMIL animation works either way, but every Meteocons file uses fixed internal ids (`mask0_…`, `clip0_…`). Inlining two of them (light + dark) would clash, and an `<img>` keeps each in its own document.
- The icons draw inside padding on a 128px canvas, so `.weather-icon-animated` is 52px with a negative margin to sit like the old 42px icon.
- **Verified live**: Dashboard (Hà Nội, clear, day) showed the animated sun and 29°, with the tooltip unchanged. A throwaway gallery page importing the real `lib/meteocons.ts` rendered all 21 mapped cases readably on both light and dark backgrounds. Toggling `data-theme` swapped the visible icon (computed `display` checked, then a screenshot). `npm run build -w client` and `npm test` (205) pass. The user's `~/.jota/config.json` (with their own City of London location) was restored byte-for-byte from a pre-test backup.

## Follow-up: hint tooltip on the plane (2026-09-26)

- User request: "show tooltip on the plane to tell user set location in settings". `AnimatedWeatherWidget` wraps the plane in the same `.weather-widget` + `.weather-tooltip` markup (modifier `.weather-widget-plane`: no padding or hover chip, since it isn't a control). It shows `weather.setLocationHint` once the location query has succeeded with no location. If a location is set but the Open-Meteo query errored, it shows `weather.unavailable` ("Couldn't load the weather for {{name}}."). While either query is still loading, the bare plane shows with no tooltip. en + vi strings added.
- Verified live with no location set: hovering the plane showed "Set your location in Settings to see the weather here." `tsc --noEmit` is clean. The error-state message wasn't exercised live.

## Follow-up: intensity + day/night icon variants (2026-09-26)

- User asked why only 21 icons were used. Open-Meteo only reports ~28 WMO codes plus `is_day`, and the first mapping merged intensities and used day/night variants only for clear/cloudy/fog. User chose to add both intensity and day/night variants (fog 45/48 still share an icon).
- `lib/meteocons.ts` now imports 43 icons into an `ICONS` name → raw-SVG table. `meteoconName(code, isDay)` maps codes through two sky ladders. Steady precipitation: light `partly-cloudy`, moderate `overcast`, heavy `extreme`. Showers: light `mostly-clear`, moderate `partly-cloudy`, heavy `extreme`. Freezing drizzle/rain use the `sleet` icons (light/heavy only), snow grains = moderate snow, 95 → `thunderstorms-*-rain`, 96 → `thunderstorms-*-hail`, 99 → `thunderstorms-extreme-*-hail`. Overcast (3) is now `overcast-day|night`.
- The new "extreme" icons draw a back cloud in `#64748B`, the same shade the light theme recolors the front cloud to. So the light-theme recolor now darkens `#64748B` → `#334155` first, then `#E6EFFC` → `#64748B`.
- Verified: a throwaway dev page rendered all 27 codes × day/night in both themes. The set of names `meteoconName` produces (42) plus `not-available` matches the 43 imports exactly, so no code falls back to N/A. `tsc` is clean and `npm run build -w client` passes.

## Follow-up: Celsius/Fahrenheit option (2026-09-26)

- User request: "add option to switch between celsius and Fahrenheit in settings". The `temperatureUnit?: 'celsius' | 'fahrenheit'` registry field (default `'celsius'`) has service get/set and `GET/PUT /api/preferences/temperature-unit`, which returns 400 on anything else. There's a Celsius/Fahrenheit radio picker (`lang-picker` style) at the top of Settings' Weather panel. `lib/weather.ts` gained `TEMPERATURE_UNITS` and `formatTemperature(celsius, unit, withUnit?)`. `AnimatedWeatherWidget` reads the preference and formats every temperature through it. Only temperature changes: wind stays km/h.
- Converting client-side (not Open-Meteo's `temperature_unit=fahrenheit`) keeps the cached reading valid across a switch. The widget and Settings share the `['temperatureUnitPreference']` query, so the Dashboard updates without a refetch.
- **Verified live** on a separate test instance (built client served by the server on :4199 with a throwaway `HOME` and scratch workspace). I didn't use the dev server on :5173 because it belongs to the user's running Electron dev session, whose embedded server predates the new route. The GET defaulted to celsius, and a PUT of `kelvin` got a 400. Clicking Fahrenheit in Settings and reloading the Dashboard showed 83°, with the tooltip at 83°F, feels like 92°F, and 89° / 78°. `npm test` (205) passes. An earlier test request that hit the user's running server had overwritten their weather location. It was restored from a backup taken just before.

## Follow-up: mph with Fahrenheit (2026-09-26)

- User request: "use mph for wind when Fahrenheit is selected". The new `formatWindSpeed(kmh, unit)` in `lib/weather.ts` returns km/h for celsius and mph (km/h ÷ 1.609344, rounded) for fahrenheit. The tooltip's Wind row uses it. There's no separate wind setting, since the temperature unit implies the system.
