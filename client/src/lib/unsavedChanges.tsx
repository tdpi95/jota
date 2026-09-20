import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * App-wide "is something mid-edit right now" registry — backs the keyboard
 * shortcuts' "warn before navigating away" behavior. Deliberately a set of
 * boolean flags keyed by mount instance, not a single global boolean: more
 * than one dirty form could in principle be registered at once (e.g. a task
 * edit `Modal` open while the compact add-task row also has typed text), and
 * unmounting one must not clobber another's flag.
 *
 * Scoped to forms that don't autosave (`TaskForm`/`ProjectForm`/
 * `QuickAddTaskModal`) — the page-level editors (journal body, note
 * body/title) already autosave with a flush-on-unmount effect, so navigating
 * away from those never loses data and doesn't need a warning.
 */
interface UnsavedChangesContextValue {
  isDirty: () => boolean;
  setDirty: (key: string, dirty: boolean) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirtyKeys = useRef(new Set<string>());
  const setDirty = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyKeys.current.add(key);
    else dirtyKeys.current.delete(key);
  }, []);
  const isDirty = useCallback(() => dirtyKeys.current.size > 0, []);
  return <UnsavedChangesContext.Provider value={{ isDirty, setDirty }}>{children}</UnsavedChangesContext.Provider>;
}

/** Registers `dirty` under a stable per-mount key while the calling
 * component is mounted, and always clears it on unmount — so closing a
 * form (submit, cancel, or the Modal it lives in going away) can never
 * leave a stale "dirty" flag behind. */
export function useUnsavedChanges(dirty: boolean) {
  const ctx = useContext(UnsavedChangesContext);
  const keyRef = useRef(`unsaved-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    ctx?.setDirty(keyRef.current, dirty);
  }, [ctx, dirty]);
  useEffect(() => {
    const key = keyRef.current;
    return () => ctx?.setDirty(key, false);
  }, [ctx]);
}

/** Returns a function that checks the registry above and, if anything is
 * currently dirty, asks the user to confirm before proceeding — for the
 * keyboard shortcuts' page-navigation actions to call before actually
 * navigating. Resolves to `true` (proceed) immediately when nothing is
 * dirty. */
export function useUnsavedChangesGuard(): () => boolean {
  const ctx = useContext(UnsavedChangesContext);
  const { t } = useTranslation();
  return useCallback(() => {
    if (!ctx?.isDirty()) return true;
    return window.confirm(t('shortcuts.confirmLeaveUnsaved'));
  }, [ctx, t]);
}
