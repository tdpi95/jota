import { useEffect, useRef } from 'react';

import { shortcutLabel } from './shortcuts';

/** Tooltip suffixes for the toggle buttons, e.g. "Edit (Ctrl+E)". */
export const VIEW_MODE_SHORTCUT_LABELS = { edit: shortcutLabel('E'), preview: shortcutLabel('P') } as const;

/**
 * Cmd/Ctrl+E → Edit, Cmd/Ctrl+P → Preview for a page's body toggle
 * (`JournalDayPage`, `NoteBodyEditor`). Page-scoped `window` listener, same
 * pattern as `useFindShortcut` — it must fire whether or not the editor has
 * focus, and in Preview there's no editor mounted to bind to at all.
 * `onChange` is whatever the toggle buttons themselves call, so a shortcut
 * behaves exactly like a click (e.g. notes persist the mode preference).
 */
export function useViewModeShortcuts(onChange: (next: 'edit' | 'preview') => void) {
  // Ref so the listener isn't re-attached every render just because the
  // caller passes a fresh inline function.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'e' && key !== 'p') return;
      // Ctrl+P would otherwise open the print dialog.
      e.preventDefault();
      onChangeRef.current(key === 'e' ? 'edit' : 'preview');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
