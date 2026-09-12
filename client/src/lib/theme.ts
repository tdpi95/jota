// App-wide UI theme (PLAN.md "Theming") — a light/dark mode plus an accent
// color palette, both persisted the same way as the UI language (see
// `i18n/index.ts`'s header comment): one app-wide preference each, read via
// `GET/PUT /api/preferences/{theme,accent-palette}` (api/client.ts), applied
// as `data-theme`/`data-palette` attributes on `<html>` so `app.css` can key
// its CSS custom properties off them. `main.tsx` resolves both before the
// first render (same "no flash of the wrong appearance" reasoning as the
// language bootstrap) and `SettingsPage`'s pickers call `applyTheme`/
// `applyAccentPalette` directly for an instant switch, no reload needed.

export const THEMES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEMES)[number];

export const ACCENT_PALETTES = ['default', 'green', 'blue', 'violet'] as const;
export type AccentPalette = (typeof ACCENT_PALETTES)[number];

// A literal preview color per palette, purely for rendering the swatch dot
// in SettingsPage's picker — same role as lib/colors.ts's COLOR_PALETTE for
// the project color picker. The actual on-screen accent color always comes
// from app.css's `--accent-hue` (kept in sync with these hues) via the
// `data-palette` attribute, never from this value directly.
export const ACCENT_PALETTE_SWATCH: Record<AccentPalette, string> = {
  default: 'oklch(58% 0.15 45)',
  green: 'oklch(58% 0.15 145)',
  blue: 'oklch(58% 0.15 250)',
  violet: 'oklch(58% 0.15 305)',
};

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', theme);
}

export function applyAccentPalette(palette: AccentPalette): void {
  document.documentElement.setAttribute('data-palette', palette);
}
