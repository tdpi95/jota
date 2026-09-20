/** Whether the app is running on macOS — Cmd is the app-wide modifier there,
 * Ctrl everywhere else. Same platform check the Dashboard's existing
 * Cmd/Ctrl+K search shortcut already used, hoisted here so every shortcut
 * (nav, quick-add) formats its on-screen hint the same way. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Renders a Cmd/Ctrl-based shortcut hint, e.g. "⌘1"/"Ctrl+1" — matches how
 * VS Code/Slack/Notion/Linear display their own shortcut hints (symbol
 * concatenated on Mac, "+"-joined elsewhere). */
export function shortcutLabel(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`;
}
