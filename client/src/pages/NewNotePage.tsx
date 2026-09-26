import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import * as api from '../api/client';
import NoteBodyEditor from '../components/NoteBodyEditor';
import TagInput from '../components/TagInput';

// Same reasoning/default as NoteDetailPage/JournalDayPage's autosave delay —
// only the value shown before `autosaveIntervalPreference` has loaded.
const DEFAULT_AUTOSAVE_DELAY_MS = 30_000;

interface Draft {
  title: string;
  tags: string[];
  body: string;
}

function hasContent(v: Draft): boolean {
  return v.title.trim().length > 0 || v.tags.length > 0 || v.body.trim().length > 0;
}

/**
 * `/notes/new` — a draft that doesn't exist on disk yet. Nothing is created
 * (no file, no index row, no git commit) until the user actually types
 * something: the first edit to title/tags/body starts the same debounce
 * `NoteDetailPage`'s autosave uses, and when it fires this creates the note
 * for the first time via `createNote` (there's no slug yet to `updateNote`).
 * On success, navigates to `/notes/<newSlug>` — from that point on it's a
 * completely ordinary `NoteDetailPage`, same "hand off once a slug exists"
 * pattern that page's own rename flow already uses. Leaving without typing
 * anything creates nothing — the point of this page: "+ New note" used to
 * `createNote` immediately on click, persisting an `untitled-note-N.md`
 * file (and a git commit) before the user had done anything at all.
 */
export default function NewNotePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const autosaveIntervalQuery = useQuery({ queryKey: ['autosaveIntervalPreference'], queryFn: api.getAutosaveIntervalPreference });
  const autosaveDelayMsRef = useRef(DEFAULT_AUTOSAVE_DELAY_MS);
  autosaveDelayMsRef.current = autosaveIntervalQuery.data ? autosaveIntervalQuery.data.autosaveIntervalSeconds * 1000 : DEFAULT_AUTOSAVE_DELAY_MS;

  const [title, setTitle] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'unsaved' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);

  const latestRef = useRef<Draft>({ title: '', tags: [], body: '' });
  const createTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against creating twice: once from the debounce firing, again from
  // the unmount-flush below (a successful create navigates away, which
  // unmounts this component and would otherwise re-trigger the flush).
  const submittedRef = useRef(false);
  latestRef.current = { title, tags, body };

  const createMutation = useMutation({
    mutationFn: (input: api.CreateNoteInput) => api.createNote(input),
    onSuccess: ({ note }) => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      // `forceEdit` keeps the handed-off NoteDetailPage in Edit mode rather
      // than flipping to the saved view-mode preference mid-composition.
      navigate(`/notes/${note.slug}`, { replace: true, state: { forceEdit: true } });
    },
    onError: (err) => {
      submittedRef.current = false;
      setSaveState('unsaved');
      setError(err instanceof api.ApiError ? err.message : t('noteDetail.createFailed'));
    },
  });

  function scheduleCreate() {
    setSaveState('unsaved');
    setError(null);
    if (createTimerRef.current) clearTimeout(createTimerRef.current);
    createTimerRef.current = setTimeout(() => {
      const latest = latestRef.current;
      if (!hasContent(latest)) {
        setSaveState('idle'); // typed something, then deleted it all before the debounce fired
        return;
      }
      submittedRef.current = true;
      setSaveState('saving');
      createMutation.mutate({ title: latest.title.trim() || t('notesList.untitled'), tags: latest.tags, body: latest.body });
    }, autosaveDelayMsRef.current);
  }

  function handleTitleChange(next: string) {
    setTitle(next);
    scheduleCreate();
  }
  function handleTagsChange(next: string[]) {
    setTags(next);
    scheduleCreate();
  }
  function handleBodyChange(next: string) {
    setBody(next);
    scheduleCreate();
  }

  // Flush on navigate-away: if the user typed something but leaves before
  // the debounce fires, create the note immediately rather than silently
  // discarding it — same reasoning as NoteDetailPage/JournalDayPage's own
  // unmount-flush. Leaving genuinely untouched (nothing typed at all) still
  // creates nothing, which is the whole point of this page.
  useEffect(() => {
    return () => {
      if (createTimerRef.current) clearTimeout(createTimerRef.current);
      if (submittedRef.current) return;
      const latest = latestRef.current;
      if (!hasContent(latest)) return;
      api.createNote({ title: latest.title.trim() || t('notesList.untitled'), tags: latest.tags, body: latest.body }).catch((err) => {
        console.error('failed to flush new-note draft on navigation:', err);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          autoFocus
        />
      </div>

      <div className="journal-tags">
        <TagInput value={tags} onChange={handleTagsChange} placeholder={t('noteDetail.tagPlaceholder')} />
      </div>

      <NoteBodyEditor body={body} onChange={handleBodyChange} forceEdit />
      <div className="journal-save-status">
        {saveState === 'unsaved' && t('noteDetail.unsaved')}
        {saveState === 'saving' && t('noteDetail.saving')}
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
