import { Link } from 'react-router-dom';

import type { IndexedNote } from '../types';
import PinButton from './PinButton';

/** One note's metadata row on `/notes` (and the Dashboard's "Pinned"
 * section) — title, tags, and when it was last updated. No body preview:
 * the index never caches note body text (PLAN.md "Notes"), so there's
 * nothing cheap to show here beyond the metadata itself. `updatedLabel` is
 * pre-formatted by the caller (`formatTimestamp`, localized) rather than
 * formatted here, matching `HistoryPanel`'s own split between data and
 * display. `pinned`/`onTogglePin` are optional, same reasoning as
 * `ProjectCard`'s. */
export default function NoteRow({
  note,
  updatedLabel,
  pinned,
  onTogglePin,
}: {
  note: IndexedNote;
  updatedLabel: string;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <Link className="note-row" to={`/notes/${note.slug}`}>
      <div className="note-row-main">
        <span className="note-title">{note.title}</span>
        {note.tags.length > 0 && (
          <div className="project-tags">
            {note.tags.map((tag) => (
              <span className="tag-pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="note-updated">{updatedLabel}</span>
      {onTogglePin && <PinButton pinned={!!pinned} onToggle={onTogglePin} />}
    </Link>
  );
}
