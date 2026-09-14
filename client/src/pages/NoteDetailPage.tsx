import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';

import * as api from '../api/client';
import HistoryPanel from '../components/HistoryPanel';
import MarkdownEditor from '../components/MarkdownEditor';
import TagInput from '../components/TagInput';
import { formatTimestamp } from '../lib/date';
import { renderMarkdownToHtml } from '../lib/renderMarkdown';

// Same reasoning/default as JournalDayPage's autosave — every autosave is
// also a git commit (the undo mechanism), so a short fixed delay would fire
// on every normal thinking pause. This is only the value shown before the
// shared `autosaveIntervalPreference` has loaded; it must match that
// preference's own server-side default (30s) or the debounce would visibly
// jump once the real value arrives.
const DEFAULT_AUTOSAVE_DELAY_MS = 30_000;

// Pencil (edit) / eye (preview, same path HistoryPanel's "view diff" button
// already uses) — icon-only, so each button still carries its label via
// `title`/`aria-label` rather than visible text.
const VIEW_MODE_ICONS: Record<'edit' | 'preview', React.ReactNode> = {
  edit: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  preview: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

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
  // Edit ↔ rendered-preview toggle for the body only (title/tags stay
  // editable regardless) — a real HTML render via markdown-it, unlike
  // MarkdownEditor's deliberate syntax-coloring-only choice for the journal
  // body (PLAN.md "Journal editor"); notes get their own separate mode
  // instead of reopening that decision. Renders straight off local `body`
  // state, not the last-saved value, so switching to Preview reflects
  // whatever's been typed even before the autosave debounce fires.
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit');
  // Same 'unsaved' (waiting out the debounce) vs 'saving' (PUT in flight)
  // split, for the same reason as JournalDayPage: labeling the whole
  // debounce window "Saving…" reads as stuck once the interval grows.
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving' | 'saved'>('idle');

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

      <div className="journal-tags">
        <TagInput value={tags} onChange={handleTagsChange} placeholder={t('noteDetail.tagPlaceholder')} />
      </div>

      <div className="note-view-toggle" role="radiogroup" aria-label={t('noteDetail.viewMode.sectionTitle') ?? undefined}>
        {(['edit', 'preview'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={viewMode === m}
            title={t(`noteDetail.viewMode.${m}`)}
            aria-label={t(`noteDetail.viewMode.${m}`)}
            className={`ws-row-btn note-view-toggle-btn ${viewMode === m ? 'is-active' : ''}`}
            onClick={() => setViewMode(m)}
          >
            {VIEW_MODE_ICONS[m]}
          </button>
        ))}
      </div>

      {viewMode === 'edit' ? (
        <MarkdownEditor className="journal-body" placeholder={t('noteDetail.bodyPlaceholder')} value={body} onChange={handleBodyChange} disabled={noteQuery.isLoading} />
      ) : body.trim() ? (
        <div className="note-preview journal-body" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(body) }} />
      ) : (
        <div className="note-preview journal-body note-preview-empty">{t('noteDetail.previewEmpty')}</div>
      )}
      <div className="journal-save-status">
        {saveState === 'unsaved' && t('noteDetail.unsaved')}
        {saveState === 'saving' && t('noteDetail.saving')}
        {saveState === 'saved' && t('noteDetail.saved')}
      </div>

      <HistoryPanel path={`notes/${slug}.md`} onReverted={invalidateNote} />
    </div>
  );
}
