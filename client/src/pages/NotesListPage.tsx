import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import * as api from '../api/client';
import { formatTimestamp } from '../lib/date';
import { usePinnedNotes } from '../lib/pins';
import NoteRow from '../components/NoteRow';

/**
 * `/notes` — every note, most-recently-updated first (PLAN.md "Notes").
 * Like `/projects`, filtering (a plain title/body-adjacent text query plus a
 * tag-pill filter) is done client-side over the full loaded list rather than
 * round-tripping to the server's `?q=` search — a personal note collection
 * is small enough that this is simpler and matches `ProjectsListPage`'s own
 * reasoning. "+ New note" skips a create form entirely — it navigates
 * straight to `/notes/new` (`NewNotePage`), a draft that isn't actually
 * created (no file, no git commit) until the user's first real edit there,
 * so clicking this and then clicking away leaves nothing behind.
 */
export default function NotesListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['notes'], queryFn: () => api.listNotes() });
  const { pinnedNoteSlugs, togglePinnedNote } = usePinnedNotes();
  const [query, setQuery] = useState('');
  const [tagFilters, setTagFilters] = useState<string[]>([]);

  function toggleTagFilter(tag: string) {
    setTagFilters((current) => (current.includes(tag) ? current.filter((existing) => existing !== tag) : [...current, tag]));
  }

  if (isLoading) return <p className="page-sub">{t('notesList.loading')}</p>;
  if (isError) return <p className="field-error">{(error as Error).message}</p>;

  const notes = data?.notes ?? [];
  const allTags = [...new Set(notes.flatMap((n) => n.tags))].sort();
  const trimmedQuery = query.trim().toLowerCase();
  const visible = notes
    .filter((n) => trimmedQuery === '' || n.title.toLowerCase().includes(trimmedQuery))
    // OR-matched, same widening-not-narrowing reasoning as ProjectsListPage's tag filter.
    .filter((n) => tagFilters.length === 0 || n.tags.some((tag) => tagFilters.includes(tag)));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('notesList.title')}</h1>
          <div className="page-sub">{t('notesList.noteCount', { count: visible.length })}</div>
        </div>
        {/* Just navigates — nothing is created here (PLAN.md "Notes": a
            draft at /notes/new only becomes a real file on its first
            actual edit, not on this click). */}
        <button className="page-action" onClick={() => navigate('/notes/new')}>
          {t('notesList.newNote')}
        </button>
      </div>

      <div className="projects-filters">
        <input
          className="notes-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('notesList.searchPlaceholder')}
        />

        {allTags.length > 0 && (
          <div className="tag-filter-row">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`tag-pill tag-pill-filter ${tagFilters.includes(tag) ? 'active' : ''}`}
                onClick={() => toggleTagFilter(tag)}
              >
                {tag}
              </button>
            ))}
            {tagFilters.length > 0 && (
              <button type="button" className="tag-filter-clear" onClick={() => setTagFilters([])}>
                {t('notesList.clear')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="notes-grid">
        {visible.map((note) => (
          <NoteRow
            key={note.slug}
            note={note}
            variant="grid"
            updatedLabel={formatTimestamp(note.updated)}
            pinned={pinnedNoteSlugs.includes(note.slug)}
            onTogglePin={() => togglePinnedNote(note.slug)}
          />
        ))}
      </div>
      {visible.length === 0 && <div className="empty-note">{notes.length === 0 ? t('notesList.empty') : t('notesList.noMatches')}</div>}
    </div>
  );
}
