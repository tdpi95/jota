import { Link } from 'react-router-dom';

import type { IndexedNote } from '../types';
import PinButton from './PinButton';

/** One note's metadata card/row — title, tags, and when it was last
 * updated. No body preview: the index never caches note body text (PLAN.md
 * "Notes"), so there's nothing cheap to show here beyond the metadata
 * itself. `updatedLabel` is pre-formatted by the caller (`formatTimestamp`,
 * localized) rather than formatted here, matching `HistoryPanel`'s own
 * split between data and display. `pinned`/`onTogglePin` are optional, same
 * reasoning as `ProjectCard`'s.
 *
 * `variant="row"` (default) is the full-width list row used on the
 * Dashboard's "Pinned" section. `variant="grid"` is a compact vertical card
 * — `/notes` (NotesListPage) — mirroring `ProjectCard`'s row/grid split. */
export default function NoteRow({
  note,
  updatedLabel,
  variant = 'row',
  pinned,
  onTogglePin,
}: {
  note: IndexedNote;
  updatedLabel: string;
  variant?: 'row' | 'grid';
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  const tags = note.tags.length > 0 && (
    <div className="project-tags">
      {note.tags.map((tag) => (
        <span className="tag-pill" key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );

  if (variant === 'grid') {
    return (
      <Link className="note-card-grid" to={`/notes/${note.slug}`}>
        {onTogglePin && <PinButton pinned={!!pinned} onToggle={onTogglePin} className="pin-btn-grid" />}
        <span className="note-title">{note.title}</span>
        {tags}
        <span className="note-updated">{updatedLabel}</span>
      </Link>
    );
  }

  return (
    <Link className="note-row" to={`/notes/${note.slug}`}>
      <div className="note-row-main">
        <span className="note-title">{note.title}</span>
        {tags}
      </div>
      <span className="note-updated">{updatedLabel}</span>
      {onTogglePin && <PinButton pinned={!!pinned} onToggle={onTogglePin} />}
    </Link>
  );
}
