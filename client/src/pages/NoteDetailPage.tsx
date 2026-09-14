import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import HistoryPanel from '../components/HistoryPanel';
import NoteBodyEditor, { VIEW_MODE_ICONS } from '../components/NoteBodyEditor';
import TagInput from '../components/TagInput';
import { formatTimestamp } from '../lib/date';

// Same reasoning/default as JournalDayPage's autosave — every autosave is
// also a git commit (the undo mechanism), so a short fixed delay would fire
// on every normal thinking pause. This is only the value shown before the
// shared `autosaveIntervalPreference` has loaded; it must match that
// preference's own server-side default (30s) or the debounce would visibly
// jump once the real value arrives.
const DEFAULT_AUTOSAVE_DELAY_MS = 30_000;

export default function NoteDetailPage() {
  const { slug } = useParams();
  if (!slug) return null;
  // Remounts the whole subtree (resetting local state/timers) on navigation
  // between notes — same reasoning as JournalDayPageInner's `key={date}`.
  return <NoteDetailPageInner key={slug} slug={slug} />;
}

function NoteDetailPageInner({ slug }: { slug: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const noteQuery = useQuery({ queryKey: ['note', slug], queryFn: () => api.getNote(slug) });
  const autosaveIntervalQuery = useQuery({ queryKey: ['autosaveIntervalPreference'], queryFn: api.getAutosaveIntervalPreference });
  const autosaveDelayMsRef = useRef(DEFAULT_AUTOSAVE_DELAY_MS);
  autosaveDelayMsRef.current = autosaveIntervalQuery.data ? autosaveIntervalQuery.data.autosaveIntervalSeconds * 1000 : DEFAULT_AUTOSAVE_DELAY_MS;

  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState('');
  // Same 'unsaved' (waiting out the debounce) vs 'saving' (PUT in flight)
  // split, for the same reason as JournalDayPage: labeling the whole
  // debounce window "Saving…" reads as stuck once the interval grows.
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved'>('idle');
  // Filename/slug editing — a separate, explicit action from the
  // continuous title/tags/body autosave above: unlike those, a rename
  // moves the actual file on disk, so it commits only when the user
  // finishes editing (Enter/blur), not per keystroke, and surfaces its own
  // error (e.g. a filename collision) rather than folding into `saveState`.
  const [editingSlug, setEditingSlug] = useState(false);
  const [slugDraft, setSlugDraft] = useState(slug);
  const [slugError, setSlugError] = useState<string | null>(null);

  // `dirty` is set only by the edit handlers below, never inferred by
  // diffing against loaded data — same race JournalDayPage's own comment
  // documents (the load-sync effect and the debounce-scheduling effect can't
  // both react to the same state change safely).
  const dirtyRef = useRef(false);
  const latestRef = useRef({ title: '', tags: [] as string[], body: '' });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  latestRef.current = { title, tags, body };

  useEffect(() => {
    if (noteQuery.data) {
      setTitle(noteQuery.data.note.frontmatter.title);
      setTags(noteQuery.data.note.frontmatter.tags);
      setBody(noteQuery.data.note.body);
    }
  }, [noteQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: api.UpdateNoteInput) => api.updateNote(slug, input),
    onSuccess: (result) => {
      setSaveState('saved');
      queryClient.setQueryData(['note', slug], result);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });

  function scheduleSave(nextTitle: string, nextTags: string[], nextBody: string) {
    dirtyRef.current = true;
    setSaveState('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      setSaveState('saving');
      saveMutation.mutate({ title: nextTitle, tags: nextTags, body: nextBody });
    }, autosaveDelayMsRef.current);
  }

  function handleTitleChange(next: string) {
    setTitle(next);
    scheduleSave(next, tags, body);
  }
  function handleTagsChange(next: string[]) {
    setTags(next);
    scheduleSave(title, next, body);
  }
  function handleBodyChange(next: string) {
    setBody(next);
    scheduleSave(title, tags, next);
  }

  // Flush a pending edit on navigate-away — same reasoning/pattern as
  // JournalDayPage: without this, an edit made just before leaving is
  // dropped when unmount clears the pending debounce timer before it fires.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (!dirtyRef.current) return;
      const latest = latestRef.current;
      const trimmedTitle = latest.title.trim();
      if (!trimmedTitle) return; // never flush a blank title; the last valid one stands
      api.updateNote(slug, { title: trimmedTitle, tags: latest.tags, body: latest.body }).catch((err) => {
        console.error('failed to flush note autosave on navigation:', err);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renameMutation = useMutation({
    mutationFn: (input: api.UpdateNoteInput) => api.updateNote(slug, input),
    onSuccess: ({ note }) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      // NoteDetailPageInner is remounted (key={slug}) by this navigation,
      // which resets all of this component's local state — no manual
      // cleanup of editingSlug/slugDraft/slugError needed.
      navigate(`/notes/${note.slug}`, { replace: true });
    },
    onError: (err) => {
      setSlugError(err instanceof api.ApiError ? err.message : t('noteDetail.renameFailed'));
      setEditingSlug(true); // reopen so the user can see the error and adjust
    },
  });

  function commitSlugEdit() {
    const nextSlug = slugDraft.trim();
    setEditingSlug(false);
    if (!nextSlug || nextSlug === slug) {
      setSlugDraft(slug);
      setSlugError(null);
      return;
    }
    // Cancel any pending autosave and fold its latest values into the same
    // rename request — the old file is about to be removed, so a separately
    // scheduled autosave firing afterward against the old slug would 404.
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    dirtyRef.current = false;
    const latest = latestRef.current;
    setSlugError(null);
    renameMutation.mutate({ newSlug: nextSlug, title: latest.title, tags: latest.tags, body: latest.body });
  }

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteNote(slug),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate('/notes');
    },
  });

  function invalidateNote() {
    // A revert changes the file out from under local state without handing
    // back the new shape — refetch rather than setQueryData (HistoryPanel's
    // own convention).
    queryClient.invalidateQueries({ queryKey: ['note', slug] });
    queryClient.invalidateQueries({ queryKey: ['notes'] });
  }

  if (noteQuery.isLoading) return <p className="page-sub">{t('noteDetail.loading')}</p>;
  if (noteQuery.isError) return <p className="field-error">{(noteQuery.error as Error).message}</p>;

  const { frontmatter } = noteQuery.data!.note;

  return (
    <div>
      <Link to="/notes" className="back-link">
        {t('noteDetail.allNotes')}
      </Link>

      <div className="note-detail-head">
        <input
          className="note-title-input"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t('noteDetail.titlePlaceholder')}
        />
        <button
          type="button"
          className="icon-btn"
          title={t('noteDetail.delete')}
          onClick={() => window.confirm(t('noteDetail.confirmDelete', { title: frontmatter.title })) && deleteMutation.mutate()}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
      <div className="page-sub">{t('noteDetail.timestamps', { created: formatTimestamp(frontmatter.created), updated: formatTimestamp(frontmatter.updated) })}</div>

      <div className="note-slug-row">
        {editingSlug ? (
          <input
            className="note-slug-input"
            value={slugDraft}
            onChange={(e) => setSlugDraft(e.target.value)}
            onBlur={commitSlugEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                setEditingSlug(false);
                setSlugDraft(slug);
                setSlugError(null);
              }
            }}
            disabled={renameMutation.isPending}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="note-slug-btn"
            title={t('noteDetail.renameFile')}
            onClick={() => {
              setSlugDraft(slug);
              setSlugError(null);
              setEditingSlug(true);
            }}
          >
            {VIEW_MODE_ICONS.edit}
            <span className="note-slug-text">notes/{slug}.md</span>
          </button>
        )}
        {slugError && <span className="field-error">{slugError}</span>}
      </div>

      <div className="journal-tags">
        <TagInput value={tags} onChange={handleTagsChange} placeholder={t('noteDetail.tagPlaceholder')} />
      </div>

      <NoteBodyEditor body={body} onChange={handleBodyChange} disabled={noteQuery.isLoading} />
      <div className="journal-save-status">
        {saveState === 'unsaved' && t('noteDetail.unsaved')}
        {saveState === 'saving' && t('noteDetail.saving')}
        {saveState === 'saved' && t('noteDetail.saved')}
      </div>

      <HistoryPanel path={`notes/${slug}.md`} onReverted={invalidateNote} />
    </div>
  );
}
