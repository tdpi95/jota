import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { MarkdownEditorHandle } from '../components/MarkdownEditor';

/**
 * Makes Cmd/Ctrl+F reliably open find in a page's `MarkdownEditor`
 * (`JournalDayPage`, `NoteBodyEditor`) — reported broken when the editor
 * isn't focused, or the page is showing its rendered Preview instead of
 * Edit. Both are real gaps in relying on `MarkdownEditor`'s own
 * `searchKeymap` binding alone: that binding only fires while CodeMirror's
 * own view has DOM focus (nothing catches the key if focus is on, say, the
 * tag input, or nowhere in particular), and in Preview mode there's no
 * CodeMirror view mounted at all to bind to. This adds a page-scoped
 * `window` keydown listener instead — scoped to this page's own lifetime,
 * same as every other per-page shortcut in this app (`JournalDayPage`'s
 * prev/next-day nav isn't global either) — that switches to Edit mode first
 * if needed, then calls the editor's imperative `openFind()` once it's
 * mounted.
 */
export function useFindShortcut(
  viewMode: 'edit' | 'preview',
  setViewMode: Dispatch<SetStateAction<'edit' | 'preview'>>,
  editorRef: RefObject<MarkdownEditorHandle | null>,
) {
  // Set when Cmd/Ctrl+F arrives while still in Preview — `setViewMode`
  // triggers a re-render that mounts `MarkdownEditor` for the first time,
  // and `editorRef.current` isn't populated until *after* that render
  // commits, so `openFind` can't be called in the same handler. The effect
  // below picks this up on the next render, once the switch to 'edit' has
  // actually landed.
  const pendingOpenRef = useRef(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return;
      e.preventDefault();
      if (viewMode !== 'edit') {
        pendingOpenRef.current = true;
        setViewMode('edit');
        return;
      }
      editorRef.current?.openFind();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [viewMode, setViewMode, editorRef]);

  useEffect(() => {
    if (viewMode !== 'edit' || !pendingOpenRef.current) return;
    pendingOpenRef.current = false;
    // Deferred a tick rather than called synchronously here: `MarkdownEditor`
    // just mounted in this same commit (this effect and its creation effect
    // both fire in the same passive-effect flush), and in StrictMode dev
    // mounts that render is followed by an immediate synthetic
    // unmount+remount to catch impure effects — `viewRef.current` briefly
    // goes back to `null` mid-dance, which `openFind` guards on and no-ops.
    // A `setTimeout` schedules this after that synchronous dance settles,
    // once the editor's `EditorView` is the real, stable instance.
    const id = setTimeout(() => editorRef.current?.openFind(), 0);
    return () => clearTimeout(id);
  }, [viewMode, editorRef]);
}
